const debug = false;
const fs = require("fs");
const htmlDocx = require("html-docx-js");
const xml2js = require("xml2js");
const cheerio = require("cheerio");
const he = require("he");
const headReplace = require("./headReplace");
const sharp = require("sharp");
const path = require("path");
const mime = require("mime");
const AdmZip = require("adm-zip");
const os = require("os");
const rimraf = require("rimraf");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs2docx-"));
const readline = require("readline");
let language = "en";
let titleElement = "BrightspaceToDocx";
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

const processZipFile = async (zipFilePath, res) => {
	const zip = new AdmZip(zipFilePath);
	zip.extractAllTo(tempDir, true);
	const imsManifestPath = path.join(tempDir, "imsmanifest.xml");

	await processImsManifest(imsManifestPath, res);

	rimraf.sync(tempDir); // Delete temporary folder
};

const urlToBase64 = async (url) => {
	// Check if the URL starts with "/shared/LCS_HTML_Templates/" and prepend the domain
	if (
		url.startsWith("/shared/LCS_HTML_Templates/") ||
		url.startsWith(`/d2l/common/`) ||
		url.startsWith(`/content/enforced/`)
	) {
		url = "https://app.csps-efpc.gc.ca" + url;
	}

	// Remove URL parameters
	url = url.split("?")[0];

	// Check if the URL is remote
	const isRemote = url.startsWith("http") || url.startsWith("https");

	// Utility to convert SVG to PNG Buffer
	const convertSvgToPng = async (inputBuffer) => {
		try {
			const pngBuffer = await sharp(inputBuffer).png().toBuffer();
			return pngBuffer;
		} catch (error) {
			console.error("Error converting SVG to PNG");
			throw error;
		}
	};

	if (isRemote) {
		const { default: fetch } = await import("node-fetch");
		const response = await fetch(url);
		const arrayBuffer = await response.arrayBuffer();
		let buffer = Buffer.from(arrayBuffer);
		const mimeType = mime.getType(url);
		const isSvg = url.toLowerCase().endsWith(".svg");

		if (isSvg) {
			buffer = await convertSvgToPng(buffer);
		}

		const base64 = buffer.toString("base64");
		return `data:image/png;base64,${base64}`;
	} else {
		if (url.includes("/") && !url.startsWith(".") && !url.startsWith("..")) {
			url = "./" + url;
		}
		const decodedUrl = decodeURI(url); // Decode the URL in case it contains spaces or other special characters
		const absoluteSrc = path.resolve(tempDir, decodedUrl);
		const correctedPath = absoluteSrc.replace(/\\/g, "/");

		return new Promise((resolve, reject) => {
			fs.readFile(correctedPath, async (error, data) => {
				if (error) {
					if (error.code === "ENOENT") {
						console.warn(`File not found, skipping: ${absoluteSrc}`);
						resolve(""); // resolve with an empty string or a placeholder image data URL
					} else {
						console.error(
							`Error converting image to base64: ${absoluteSrc}`,
							error
						);
						reject(error);
					}
				} else {
					const mimeType = mime.getType(absoluteSrc);
					const isSvg = absoluteSrc.toLowerCase().endsWith(".svg");

					if (isSvg) {
						data = await convertSvgToPng(data);
					}

					const base64 = data.toString("base64");
					const final = `data:${
						isSvg ? "image/png" : mimeType
					};base64,${base64}`;
					resolve(`${final}`);
				}
			});
		});
	}
};

const sanitizeFilename = (filename) => {
	if (typeof filename !== "string") {
		console.error("Invalid filename:", filename);
		filename = "default_filename";
	}
	// Replace illegal characters with a safe alternative
	return filename.replace(/[ <>:"/\\|?*]/g, "_");
};

const readFile = (path) => {
	let correctedPath = path.replace(/\\/g, "/");
	return new Promise((resolve, reject) => {
		fs.readFile(correctedPath, "utf8", (err, content) => {
			if (err) {
				reject(err);
			} else {
				resolve(content);
			}
		});
	});
};

const decodeHtml = (encodedHtml) => {
	return he.decode(String(encodedHtml));
};
const svgStringToPngBuffer = async (svgString) => {
	return sharp(Buffer.from(svgString)).png().toBuffer();
};

const processHtmlFiles = async (
	itemResourceMap,
	docxFileName,
	quizHtmlContentMap,
	fileType,
	res
) => {
	let combinedHtmlContent = "";
	let firstHeadTag = "";
	let insertedQuiz = new Set();

	const embedImages = async ($, htmlFilePath) => {
		const images = $("img");
		const directoryPath = path.dirname(htmlFilePath);

		for (let i = 0; i < images.length; i++) {
			const img = images.eq(i);
			let src = img[0].attribs.src;

			if (
				src.startsWith("/shared/LCS_HTML_Templates/") ||
				src.startsWith(`/d2l/common/`) ||
				src.startsWith(`/content/enforced/`)
			) {
				src = "https://app.csps-efpc.gc.ca" + src;
			}

			// Remove URL parameters
			src = src.split("?")[0];

			// Check if src is an absolute URL
			if (src.startsWith("http://") || src.startsWith("https://")) {
				// Do nothing, src is already an absolute URL
			} else {
				// Resolve the absolute path of the image
				if (
					src.includes("/") &&
					!src.startsWith(".") &&
					!src.startsWith("..")
				) {
					src = "./" + src;
				}
				const absoluteSrc = path.resolve(directoryPath, src);
				src = decodeURIComponent(absoluteSrc);
				// console.log("src: " + src);
			}

			try {
				const base64Data = await urlToBase64(src);
				if (!base64Data.startsWith("data:")) {
					throw new Error(`Invalid data URL: ${base64Data}`);
				}
				img.attr("src", base64Data);
			} catch (err) {
				console.error(`Error converting image to base64: ${src}`, err);
			}
		}
		return $.html();
	};

	for (const [title, resourceData] of Object.entries(itemResourceMap)) {
		const { href, description } = resourceData;
		// Check if the current title exists in quizHtmlContentMap

		const quizContent = quizHtmlContentMap[title];

		const htmlFilePath = path.join(tempDir, href);
		const fileContent = href ? await readFile(htmlFilePath) : "";
		let $ = href ? cheerio.load(fileContent) : null;
		let bodyContent = $ ? $("body").html() : "";

		// If quizContent exists, use it as the bodyContent
		if (quizContent) {
			bodyContent = quizContent;
		}

		const decodedDescription = description ? decodeHtml(description) : "";
		const titleWithDescription = description
			? `<h1>${title}</h1>\n${decodedDescription}\n`
			: "";

		if ($) {
			bodyContent = await embedImages($, htmlFilePath);
			const headContent = $("head").html();

			if (!firstHeadTag) {
				firstHeadTag = headContent;
			}
		}
		combinedHtmlContent += `${titleWithDescription}${bodyContent}\n`;
	}

	const $ = cheerio.load(combinedHtmlContent);

	const imagesAndSvgs = $("img, svg");
	const imagePromises = [];
	imagesAndSvgs.each((index, el) => {
		const element = $(el);
		const isSvgElement = el.tagName.toLowerCase() === "svg";
		const url = element.attr("src");

		// Separate handling for <svg> elements
		if (isSvgElement) {
			const svgString = $.html(element);
			const promise = svgStringToPngBuffer(svgString)
				.then((buffer) => {
					const pngBase64DataUrl = `data:image/png;base64,${buffer.toString(
						"base64"
					)}`;
					element.replaceWith(`<img src="${pngBase64DataUrl}"/>`);
				})
				.catch((err) => {
					// console.warn(`Error processing inline SVG element, skipping: ${svgString}`);
					// console.warn(err.message);
				});
			imagePromises.push(promise);
			return; // Skip the rest of this iteration, proceed to the next element
		}

		const isSvg = url && url.toLowerCase().endsWith(".svg");
		const isDataUrl = url && url.startsWith("data:");

		try {
			if (isSvg) {
				const promise = urlToBase64(url)
					.then((base64DataUrl) => {
						if (base64DataUrl.startsWith("data:image/svg+xml;base64,")) {
							return sharp(Buffer.from(base64DataUrl.split(",")[1], "base64"))
								.png()
								.toBuffer();
						} else {
							throw new Error(`Invalid data URL: ${base64DataUrl}`);
						}
					})
					.then((buffer) => {
						const pngBase64DataUrl = `data:image/png;base64,${buffer.toString(
							"base64"
						)}`; // Fix MIME type for PNG data URL
						element.attr("src", pngBase64DataUrl);
					})
					.catch((err) => {
						// console.warn(`Error processing SVG image, skipping: ${url}`);
						// console.warn(err.message);
					});
				imagePromises.push(promise);
			} else if (isDataUrl) {
				// console.log("data url: Found");
				const promise = () => {
					element.attr("src", url);
				};
				imagePromises.push(promise);
			} else {
				const promise = urlToBase64(url)
					.then((base64DataUrl) => {
						element.attr("src", base64DataUrl);
					})
					.catch((err) => {
						// Add catch block for non-SVG and non-data URL images
						console.warn(`Error processing image, skipping image: ${url}`);
						if (debug) console.warn(err.message);
					});
				imagePromises.push(promise);
			}
		} catch (err) {
			console.error(`Error processing image, skipping image: ${url}`);
		}
	});

	await Promise.all(imagePromises);
	combinedHtmlContent = $.html();

	const resultHtml = `
  <!DOCTYPE html>
  <html lang="${language}">
  <head>
    <meta charset="UTF-8">
    ${headReplace}
    <title>${titleElement}</title>
  </head>
  <body>
    ${combinedHtmlContent}
  </body>
  </html>
    `;

	// if (fileType === "html") {
	// 	fs.writeFile(docxFileName.replace(".docx", ".html"), resultHtml, (err) => {
	// 		if (err) {
	// 			console.error(
	// 				`Error writing ${docxFileName.replace(".docx", ".html")}:`,
	// 				err
	// 			);
	// 		} else {
	// 			console.log(
	// 				`\x1b[33m
	//       ${docxFileName.replace(".docx", ".html")} created successfully.
	//       \x1b[0m`
	// 			);
	// 		}
	// 	});
	// } else {
	// 	const docx = htmlDocx.asBlob(resultHtml);
	// 	const buffer = Buffer.from(await docx.arrayBuffer());
	// 	fs.writeFile(docxFileName, buffer, (err) => {
	// 		if (err) {
	// 			console.error(`Error writing ${docxFileName}:`, err);
	// 		} else {
	// 			console.log(`${docxFileName} created successfully.`);
	// 		}
	// 	});
	// }
	if (fileType === "html") {
		res.setHeader("Content-Type", "text/html");
		res.setHeader(
			"Content-Disposition",
			"attachment; filename=" + docxFileName.replace(".docx", ".html")
		);
		res.send(resultHtml);
	} else {
		const docx = htmlDocx.asBlob(resultHtml);
		const buffer = Buffer.from(await docx.arrayBuffer());
		res.setHeader(
			"Content-Type",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		);
		res.setHeader(
			"Content-Disposition",
			"attachment; filename=" + docxFileName
		);
		res.send(buffer);
	}
};

const parseItems = (itemList, itemResourceMap, resourceMap) => {
	itemList.forEach((item) => {
		if (!item || !item.$ || !item.title) {
			console.warn("Invalid item structure encountered, skipping");
			return;
		}
		const identifierRef = item.$.identifierref;
		const title = item.title[0];
		const description = item.$.description;
		const isHidden = item.$.isvisible === "False";

		if (resourceMap[identifierRef]) {
			const resourceData = resourceMap[identifierRef];
			itemResourceMap[title] = {
				href: resourceData.isHtmlResource ? resourceData.href : "",
				description: description ? description : "",
			};
		}

		if (item.item) {
			parseItems(item.item, itemResourceMap, resourceMap);
		}
	});
};

async function parseQuizXml(xmlString) {
	let parsedData;
	let quizData = [];
	let items = [];
	let sectionItems = [];

	try {
		parsedData = await xml2js.parseStringPromise(xmlString, {
			explicitArray: false,
			tagNameProcessors: [xml2js.processors.stripPrefix],
		});
	} catch (error) {
		console.error("Error parsing XML: ", error);
		return quizData;
	}

	if (
		!parsedData ||
		!parsedData.questestinterop ||
		!parsedData.questestinterop.assessment
	) {
		console.error("Unexpected structure in parsed XML data");
		return quizData;
	}

	const sections =
		parsedData.questestinterop.assessment.section.$.ident ===
		"CONTAINER_SECTION"
			? parsedData.questestinterop.assessment.section
			: parsedData.questestinterop.assessment.section;

	if (!sections) {
		console.error("No sections found in parsed XML data");
		return quizData;
	}

	// Make sure sections is an array
	const sectionArray = Array.isArray(sections) ? sections : [sections];

	function processSection(section) {
		console.log("Processing section: ", section.$.ident);
		// Get items and itemRefs in the section
		sectionItems = section.item
			? Array.isArray(section.item)
				? section.item
				: [section.item]
			: [];

		itemRefs = section.itemref
			? Array.isArray(section.itemref)
				? section.itemref
				: [section.itemref]
			: [];

		if (!sectionItems.length && !itemRefs.length) {
			console.warn("No items or item references found in quiz XML section");
			return;
		}

		// Tag each element as either an item or an itemRef
		sectionItems = sectionItems.map((item) => ({ ...item, type: "item" }));
		itemRefs = itemRefs.map((itemRef) => ({ ...itemRef, type: "itemRef" }));

		// Add items and itemRefs to global lists
		items.push(...sectionItems);
		items.push(...itemRefs);
	}

	if (debug) console.log("469 Section array: ", items.length);
	let processedItems = [];
	for (const section of sectionArray) {
		if (debug) console.log("470 Section: ", section.$.ident);
		processSection(section);

		// Also process nested sections, if they exist.
		if (section.section && Array.isArray(section.section)) {
			if (debug) console.log("475 Nested section found");
			for (const nestedSection of section.section) {
				processSection(nestedSection);
			}
		}
		if (debug) console.log("482 items: ", items.length);
		// Process items and itemRefs

		// Process items and itemRefs
		for (const element of items) {
			if (element.type === "item") {
				// Handle items...
				processedItems.push(element); // Add the processed item to the new array
			} else if (element.type === "itemRef") {
				// Handle itemRefs...
				if (element["file"] && element["file"].$.href === "questiondb.xml") {
					const item = await findItemByLabel(
						"questiondb.xml",
						element.$.linkrefid
					);
					if (!item) {
						console.warn(
							`Could not find item with id ${element.$["linkrefid"]} in questiondb.xml`
						);
					} else {
						processedItems.push({ ...item, type: "itemLinked" }); // Add the linked item to the new array
					}
				}
			}
		}
	}
	// Replace the old items array with the new one
	items = processedItems;

	if (!items) {
		console.warn("No items found", xmlString);
		return;
	}
	if (debug) console.log("515 Quiz items: ", items.length);
	items.forEach((item, index) => {
		let metadataFields = [];
		// Check if qti_metadatafield exists
		if (item.itemmetadata) {
			metadataFields = item.itemmetadata.qtimetadata.qti_metadatafield;

			const qmdQuestionTypeField = metadataFields.find(
				(field) => field.fieldlabel === "qmd_questiontype"
			);
			const qmdQuestionTypeValue = qmdQuestionTypeField
				? qmdQuestionTypeField.fieldentry
				: null;

			const isMultipleChoice = qmdQuestionTypeValue === "Multiple Choice";
			const isMultiSelect = qmdQuestionTypeValue === "Multi-Select";
			const isOrdering = qmdQuestionTypeValue === "Ordering";
			const isTrueFalse = qmdQuestionTypeValue === "True/False";
			const isMatching = qmdQuestionTypeValue === "Matching";
			if (debug) console.log("531 Question Type: ", qmdQuestionTypeValue);

			if (isMultipleChoice) {
				if (!item.presentation || !item.presentation?.flow) {
					return;
				}

				const questionText = item.presentation.flow.material.mattext._;

				const answerOptions =
					item.presentation.flow.response_lid.render_choice.flow_label;

				const answerChoices = answerOptions.map(
					(answerOption) =>
						answerOption.response_label.flow_mat.material.mattext._
				);

				const feedbacks = item.itemfeedback.map(
					(feedback) => feedback.material.mattext._
				);

				const correctAnswerIdent = item.resprocessing.respcondition.find(
					(condition) => parseFloat(condition.setvar._)
				).conditionvar.varequal._;
				const correctAnswerIndex = answerOptions.findIndex(
					(answerOption) =>
						answerOption.response_label.$.ident === correctAnswerIdent
				);
				const correctAnswer = String.fromCharCode(65 + correctAnswerIndex);

				quizData.push({
					question: questionText,
					answerChoices: answerChoices,
					correctAnswer: correctAnswer,
					feedbacks: feedbacks,
				});
			} else if (isMultiSelect) {
				const questionText = item.presentation.flow.material.mattext._;
				const answerOptions =
					item.presentation.flow.response_lid.render_choice.flow_label;
				const answerChoices = answerOptions.map(
					(answerOption) =>
						answerOption.response_label.flow_mat.material.mattext._
				);

				// Extract correct answers based on the 'setvar' value of 1
				const correctAnswerIdents = item.resprocessing.respcondition
					.filter((condition) => condition.setvar._ === "1")
					.flatMap((condition) => {
						if (condition.conditionvar.varequal) {
							return condition.conditionvar.varequal;
						}
						return [];
					});

				// Extract response_label objects
				const responseLabels =
					item.presentation.flow.response_lid.render_choice.flow_label.map(
						(flow_label) => flow_label.response_label
					);

				// Save the correct answers as an array of uppercase letters
				const correctAnswers = correctAnswerIdents.map((ident) => {
					const responseLabel = responseLabels.find(
						(label) => label.$.ident === ident._
					);
					const answerIndex = responseLabels.indexOf(responseLabel);
					const letter = String.fromCharCode(65 + answerIndex); // Convert the index to an uppercase letter
					return letter;
				});

				quizData.push({
					questionType: "Multi-Select",
					question: questionText,
					answerChoices: answerChoices,
					correctAnswer: correctAnswers.join(", "),
				});
			} else if (isOrdering) {
				const question = item.presentation.flow.material.mattext._;

				const choices =
					item.presentation.flow.response_grp.render_choice.flow_label.response_label.map(
						(choice) => {
							return choice.flow_mat.material.mattext._;
						}
					);
				// Extract correct answers based on the 'setvar' value of 1
				const correctAnswerIndices = item.resprocessing.respcondition
					.filter((condition) => condition.setvar._ === "1")
					.flatMap((condition) => {
						if (condition.conditionvar.varequal) {
							return condition.conditionvar.varequal._;
						} else if (
							condition.conditionvar.not &&
							condition.conditionvar.not.varequal
						) {
							return [];
						}
						return [];
					});

				// Save the correct answers as an array of uppercase letters
				const correctAnswers = correctAnswerIndices.map((index) => {
					const letter = String.fromCharCode(
						64 + parseInt(index.split("_").pop())
					); // Convert the index to an uppercase letter
					return letter;
				});

				// console.log("Question:", question);
				// console.log("Choices:", choices);
				quizData.push({
					questionType: "Ordering",
					question: question,
					answerChoices: choices,
					correctAnswer: correctAnswers,
				});
			} else if (isTrueFalse) {
				if (!item.presentation || !item.presentation?.flow) {
					return;
				}

				const questionText = item.presentation.flow.material.mattext._;

				const answerOptions =
					item.presentation.flow.response_lid.render_choice.flow_label;

				const answerChoices = answerOptions.map(
					(answerOption) =>
						answerOption.response_label.flow_mat.material.mattext._
				);

				const correctAnswerIdent = item.resprocessing.respcondition.find(
					(condition) => parseFloat(condition.setvar._) === 100
				).conditionvar.varequal._;

				const correctAnswerIndex = answerOptions.findIndex(
					(answerOption) =>
						answerOption.response_label.$.ident === correctAnswerIdent
				);

				const correctAnswer = answerChoices[correctAnswerIndex];

				quizData.push({
					questionType: "True/False",
					question: questionText,
					answerChoices: answerChoices,
					correctAnswer: correctAnswer,
				});
			} else if (isMatching) {
				const parseConditions = (respConditions) => {
					return respConditions.map((condition) => {
						let conditionvar = condition.conditionvar;
						let setvar = condition.setvar;

						// Condition details
						let responseIdentifier, match;
						if (conditionvar.varequal) {
							responseIdentifier = conditionvar.varequal.$.respident; // Switched
							match = conditionvar.varequal._; // Switched
						} else if (conditionvar.vargte) {
							responseIdentifier = conditionvar.vargte.$.respident; // Switched
							match = conditionvar.vargte._; // Switched
						}

						return {
							condition: {
								responseIdentifier,
								match,
							},
							action: {
								varName: setvar.$.varname,
								actionType: setvar.$.action,
								value: Number(setvar._),
							},
						};
					});
				};

				// Parse the question
				const question = item.presentation.flow.material.mattext._;

				// Parse the answer choices
				const answerChoices = item.presentation.flow.response_grp.map(
					(responseGroup) => ({
						label: responseGroup.material.mattext._,
						options: responseGroup.render_choice.flow_label.response_label.map(
							(label) => ({
								text: label.flow_mat.material.mattext._,
								ident: label.$.ident,
							})
						),
					})
				);

				// Parse the correct answer
				const correctAnswerData = parseConditions(
					item.resprocessing.respcondition
				);

				// Parse the feedback
				const feedback = item.itemfeedback?.material.mattext._;

				quizData.push({
					questionType: "Matching",
					question: question,
					answerChoices: answerChoices,
					correctAnswer: correctAnswerData,
					feedbacks: feedback,
				});
			} else {
				console.warn("Question type not supported:" + qmdQuestionTypeValue);
				return;
			}
		} else {
			console.warn("Metadata fields not found for item index: " + index);
			if (debug) console.log("No MD in", item);
		}
	});

	return quizData;
}

const findItemByLabel = (() => {
	let cacheKey = null;
	let itemsCache = null;

	const processItems = (items, map) => {
		// Ensure 'items' is an array (even if it's only one item)
		const itemsArray = Array.isArray(items) ? items : [items];

		// Add each item to the map
		itemsArray.forEach((item) => map.set(item.$.label, item));
	};

	const processSection = (section, map) => {
		// Navigate to 'item' array in current section
		const items = section.item ? processItems(section.item, map) : null;

		// If current section contains nested sections, process those too
		const nestedSections = section.section
			? Array.isArray(section.section)
				? section.section
				: [section.section]
			: [];

		// Now it's safe to iterate over nestedSections
		for (const nestedSection of nestedSections) {
			processSection(nestedSection, map);
		}
	};

	return async (filePath, label) => {
		// Check if the cacheKey matches the current filePath
		if (cacheKey !== filePath) {
			cacheKey = filePath;
			itemsCache = new Map();

			// Read and parse XML file
			const quizDBFilePath = path.join(tempDir, filePath);
			const xml = await readFile(quizDBFilePath);

			const result = await xml2js.parseStringPromise(xml, {
				explicitArray: false,
				tagNameProcessors: [xml2js.processors.stripPrefix],
			});

			// Get objectbank
			const objectbank = result.questestinterop.objectbank;

			// Process items directly under 'objectbank', if they exist
			if (objectbank.item) {
				processItems(objectbank.item, itemsCache);
			}

			// Make sure 'section' is an array (even if it's only one section)
			const sections = objectbank.section
				? Array.isArray(objectbank.section)
					? objectbank.section
					: [objectbank.section]
				: undefined;

			// Process each section, adding items to the map
			sections &&
				sections.forEach((section) => processSection(section, itemsCache));
		}

		// Find the object where the '$.label' property matches the provided label
		return itemsCache.get(label);
	};
})();

function isCorrectChoice(correctAnswerData, groupIdent, choiceIdent) {
	return correctAnswerData.some((cond) => {
		const { condition, action } = cond;
		return (
			condition.responseIdentifier === groupIdent &&
			condition.match === choiceIdent &&
			action.varName === "D2L_Correct"
		);
	});
}

const formatQuizDataAsHtml = (quizData, title) => {
	let quizHtml = `<h1>${title}</h1> <ol>`;
	if (!quizData) return "<h1>Missing quiz data</h1>";
	quizData.forEach((quizItem) => {
		let { questionType, question, answerChoices, feedbacks, correctAnswer } =
			quizItem;
		if (!question) return;
		if (questionType !== "Matching") {
			correctAnswer = correctAnswer ? correctAnswer : "N/A";

			quizHtml += `<li><div>${question}</div><ol type="A">`;

			answerChoices.forEach((choice, index) => {
				quizHtml += `<li>${choice}</li>`;
			});
			quizHtml += language.toString().startsWith("en")
				? `</ol><p>Correct Answer: ${correctAnswer}</p></li>`
				: `</ol><p>Bonne réponse: ${correctAnswer}</p></li>`;

			quizHtml += feedbacks ? `<p>Feedback: ${feedbacks}</p>` : "";
		} else {
			quizHtml += `<li><div>${question}</div><ul>`;

			answerChoices.forEach((group) => {
				quizHtml += `<h3>${group.label}</h3><ul>`;
				group.options.forEach((option) => {
					const isCorrect = isCorrectChoice(
						correctAnswer,
						group.ident,
						option.ident
					);
					quizHtml += `<li>${option.text}${isCorrect ? " (Correct)" : ""}</li>`;
				});
				quizHtml += "</ul>";
			});

			quizHtml += `</ul><h2>Feedback</h2><p>${feedbacks}</p></li>`;
		}
	});

	quizHtml += "</ol>";
	return quizHtml;
};

const parseQuizXmlFile = async (quizFilePath) => {
	// console.log("Parsing quiz file: " + quizFilePath);
	const quizContent = await readFile(quizFilePath);
	const quizData = await parseQuizXml(quizContent);
	return quizData;
};
const processImsManifest = async (imsManifestPath, res) => {
	const manifestContent = await readFile(imsManifestPath);
	const parser = new xml2js.Parser();
	const manifestJson = await parser.parseStringPromise(manifestContent);
	const quizHtmlContentMap = {};
	let titleToResourceMap = {};

	if (
		!manifestJson ||
		!manifestJson.manifest ||
		!manifestJson.manifest.organizations ||
		!manifestJson.manifest.organizations[0] ||
		!manifestJson.manifest.organizations[0].organization ||
		!manifestJson.manifest.organizations[0].organization[0]
	) {
		console.error("Invalid imsmanifest.xml structure");
		return;
	}

	const metadata =
		manifestJson.manifest.metadata?.[0]?.["imsmd:lom"]?.[0]?.[
			"imsmd:general"
		]?.[0];
	const organization =
		manifestJson.manifest.organizations?.[0]?.organization?.[0];

	if (!metadata) {
		console.error("Invalid imsmanifest.xml structure: Metadata not found");
		return;
	}

	const resourceMap = {};
	const itemResourceMap = {};

	if (
		!manifestJson.manifest.resources ||
		!manifestJson.manifest.resources[0] ||
		!manifestJson.manifest.resources[0].resource
	) {
		console.error("Invalid imsmanifest.xml structure: No resources found");
		return;
	}

	function populateIdentifierRefMap(item, map) {
		if (item.$ && item.title && item.title[0]) {
			map[item.$.identifierref] = item.title[0];
		}
		if (item.item) {
			for (const subItem of item.item) {
				populateIdentifierRefMap(subItem, map);
			}
		}
	}

	// Create a map of identifierrefs to titles
	const identifierRefToTitleMap = {};
	for (const item of organization.item) {
		populateIdentifierRefMap(item, identifierRefToTitleMap);
	}

	// Inside the processImsManifest function, after parsing the resources
	// we can iterate over the resources and check if the resource is a quiz
	// First loop: populate resourceMap and titleToResourceMap
	for (const resource of manifestJson.manifest.resources[0].resource) {
		const identifier = resource.$.identifier;
		let title = resource.$.title;
		const href = resource.$.href;
		const materialType = resource.$["d2l_2p0:material_type"];
		const isHtmlResource = href && href.toLowerCase().endsWith(".html");
		let isQuizResource =
			href &&
			href.toLowerCase().endsWith(".xml") &&
			(materialType === "d2lquiz" || materialType === "d2lselfassess");
		const isContentLink = materialType === "contentlink";
		let finalHref = href;

		// If it's a contentlink with a quiz, update the href to that of a quiz with the same title, if one exists.
		if (isContentLink && href && href.toLowerCase().includes("type=quiz")) {
			for (let id in resourceMap) {
				if (resourceMap[id].title === title && resourceMap[id].isQuizResource) {
					title = identifierRefToTitleMap[id];
					finalHref = resourceMap[id].href;
					isQuizResource = true;
					break;
				}
			}
		}

		resourceMap[identifier] = {
			href: finalHref,
			isHtmlResource,
			isQuizResource,
			title,
		};

		if (isQuizResource) {
			if (debug) console.log("984 Title: " + title);
			// if (!isContentLink) {
			titleToResourceMap[title] = identifier;
			const quizFilePath = path.join(tempDir, href);
			if (debug) console.log("982 Parsing quiz file: " + quizFilePath);
			const quizData = await parseQuizXmlFile(quizFilePath);
			const quizHtmlContent = formatQuizDataAsHtml(quizData, title);
			quizHtmlContentMap[title] = quizHtmlContent;

			// } else {
			// 	console.log("Title 3: " + title);
			// 	titleToResourceMap[title] = identifier;
			// 	title = identifierRefToTitleMap[identifier];
			// }
		}
		parseItems(
			organization.item,
			itemResourceMap,
			resourceMap,
			quizHtmlContentMap
		);
	}

	// Second loop: process content links
	for (const title in titleToResourceMap) {
		const identifier = titleToResourceMap[title];
		const resourceData = resourceMap[identifier];
		if (resourceData.isQuizResource) {
			const quizFilePath = path.join(tempDir, resourceData.href);
			const quizData = await parseQuizXmlFile(quizFilePath);
			const quizHtmlContent = formatQuizDataAsHtml(quizData, title);
			quizHtmlContentMap[title] = quizHtmlContent;
		}
	}

	const titleElement =
		metadata["imsmd:title"]?.[0]?.["imsmd:langstring"]?.[0]._;
	language = metadata["imsmd:language"];
	const sanitizedTitle = sanitizeFilename(titleElement);
	if (debug) console.log("1016 Title: " + sanitizedTitle);
	const docxFileName = `${sanitizedTitle}.docx`;

	await processHtmlFiles(
		itemResourceMap,
		docxFileName,
		quizHtmlContentMap,
		fileType,
		res
	);
};
let fileType;
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.post("/upload", upload.single("file"), (req, res) => {
	zipFilePath = req.file.path;
	fileType = req.body.fileType;
	if (zipFilePath) {
		processZipFile(zipFilePath, res).catch((err) => {
			console.error("Error processing zip file:", err);
			res
				.status(500)
				.send({ message: "Error processing the file.", error: err.message });
		});
	} else {
		console.error("Please provide a zip file path as a command-line argument.");
		res
			.status(400)
			.send({ message: "No file uploaded. Please provide a zip file." });
	}
});

app.listen(port, () => {
	console.log(`Server is listening on port ${port}`);
});
