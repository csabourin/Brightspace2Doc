// createElem: Creates an element with the given attributes.
const createElem = (type, attrs = {}) => {
	const elem = document.createElement(type);
	Object.entries(attrs).forEach(([attr, value]) => (elem[attr] = value));
	return elem;
};

function getLocalizedString(lang, englishText, frenchText) {
	return lang === "en" ? englishText : frenchText;
}

// Get the lang attribute from the html tag
const lang = document.querySelector("html").getAttribute("lang") || "en";
const unsavedResponseText = getLocalizedString(
	lang,
	"Unsaved response",
	"Réponse non enregistrée"
);
const saveButtonText = getLocalizedString(lang, "Save", "Enregistrer");
const savedButtonText = getLocalizedString(lang, "Saved", "Enregistré");
const useUnsavedResponseText = getLocalizedString(
	lang,
	"Use Unsaved Response",
	"Utiliser la réponse non enregistrée"
);
const noResponseGivenText = getLocalizedString(
	lang,
	"No response given",
	"Aucune réponse donnée"
);
const savingText = getLocalizedString(lang, "Saving...", "Enregistrement...");
const reflectionReportText = getLocalizedString(
	lang,
	"Reflection Report",
	"Rapport de réflexion"
);
const downloadText = getLocalizedString(lang, "Download", "Télécharger");

var SocraticTool = {};
SocraticTool.roles = [
	"Learner - Apprenant",
	"Learner View - Vue de l'apprenant",
	"Learner/Employee",
	"Guest Learner",
	"Apprenant / Learner",
	"Test Guest Learner",
	"Guest OGD Learner",
	"Guest GAC Family Relation Learner",
	"Root Learner",
];
SocraticTool.toc = null;
SocraticTool.changed = false;
SocraticTool.response = null;
// init: Initializes the SocraticTool with enrollment data and checks for required elements on the page.
SocraticTool.init = function (data) {
	SocraticTool.enrollments = data;

	const questionTool = document.getElementById("questionTool");
	const questionReferences = document.querySelectorAll(".questionReference");
	const questionReport = document.getElementById("questionReport");

	if (questionTool || questionReferences.length > 0) {
		SocraticTool.buildReflection = true;

		libVal.get.toc(SocraticTool.ouID, SocraticTool.processTOC);
	} else if (questionReport) {
		SocraticTool.buildReport = true;

		const reportData = questionReport.getAttribute("data-reference");
		if (reportData !== null) {
			SocraticTool.reportTopics = reportData
				.replace(/\s*\|\s*/g, "|")
				.replace(/^\s*/g, "")
				.replace(/\s+$/g, "")
				.replace(/\s*\[/g, "[")
				.split("||");

			libVal.get.toc(SocraticTool.ouID, SocraticTool.processTOC);
		}
	}
};
// processTOC: Processes the table of contents data and collects all topics.
SocraticTool.processTOC = function (data) {
	SocraticTool.topicList = [];
	SocraticTool.toc = data;
	SocraticTool.toc.activeCount = SocraticTool.toc.Modules.length;
	SocraticTool.toc.Modules.forEach((mod) => SocraticTool.collectTopics(mod));
};
// collectTopics: Collects all the topics from the given module and its submodules.
SocraticTool.collectTopics = function (mod) {
	mod.Topics.forEach((topic) => SocraticTool.topicList.push(topic));
	mod.Modules.forEach((subMod) => SocraticTool.collectTopics(subMod));

	if (--SocraticTool.toc.activeCount === 0) {
		SocraticTool.startBuild();
	}
};
// startBuild: Starts the build process for the reflection or report.
SocraticTool.startBuild = function () {
	const foundTopic = SocraticTool.topicList.find(
		(topic) => topic.Identifier === SocraticTool.topicID
	);
	const questionReferences = document.querySelectorAll(".questionReference");

	if (foundTopic) {
		SocraticTool.topicTitle = foundTopic.Title;
	}

	if (SocraticTool.buildReflection) {
		let foundReference = false;

		questionReferences.forEach((element) => {
			const refTitle = element.getAttribute("data-topic").trim();
			const refTopic = SocraticTool.topicList.find(
				(topic) => topic.Title.trim() === refTitle
			);

			if (refTopic) {
				foundReference = true;
				element.id = refTopic.Identifier;
				element.setAttribute("data-title", refTitle);
			}
		});

		if (foundTopic || foundReference) {
			libVal.get.folders(SocraticTool.ouID, {}, SocraticTool.processFolders);
		}
	} else if (SocraticTool.buildReport) {
		libVal.get.folders(SocraticTool.ouID, {}, SocraticTool.processFolders);
	}
};
// Processes the folders for building reflection or report.
SocraticTool.processFolders = function (data) {
	SocraticTool.folders = data;
	const isStudentRole = SocraticTool.roles.includes(
		SocraticTool.enrollments.Access.ClasslistRoleName
	);
	const questionReferences = document.querySelectorAll(".questionReference");

	if (SocraticTool.buildReflection) {
		const targetFolder = SocraticTool.folders.find(
			(folder) => folder.Name === SocraticTool.topicTitle
		);

		if (targetFolder) {
			SocraticTool.folderID = targetFolder.Id;
			SocraticTool.folder = targetFolder;

			if (isStudentRole) {
				libVal.get.submissions(
					SocraticTool.ouID,
					SocraticTool.folderID,
					{},
					SocraticTool.processSubmissions,
					{ type: "topic" }
				);
			} else {
				SocraticTool.updateForm({ type: "topic" });
			}
		}

		questionReferences.forEach((questionReference) => {
			const dataTitle = questionReference.getAttribute("data-title");

			if (dataTitle) {
				const referenceFolder = SocraticTool.folders.find(
					(folder) => folder.Name === dataTitle
				);

				if (referenceFolder) {
					libVal.get.submissions(
						SocraticTool.ouID,
						referenceFolder.Id,
						{},
						SocraticTool.processSubmissions,
						{
							type: "reference",
							id: questionReference.getAttribute("id"),
							instructions: questionReference.getAttribute("data-instructions"),
							folder: referenceFolder,
						}
					);
				}
			}
		});
	} else if (SocraticTool.buildReport) {
		SocraticTool.updateReport();
	}
};
// processSubmissions: Processes the submissions based on the type (topic or reference).
SocraticTool.processSubmissions = function (data, storage) {
	if (storage.type === "topic") {
		SocraticTool.submissions = data;
	} else {
		storage.submissions = data;
	}

	SocraticTool.updateForm(storage);
};
// Updates the form with user response and other elements depending on the type.
SocraticTool.updateForm = function (data) {
	const isStudentRole = SocraticTool.roles.includes(
		SocraticTool.enrollments.Access.ClasslistRoleName
	);
	const questionTool = document.getElementById("questionTool");

	if (data.type === "topic") {
		const [instructions, input, unsaved, save, restore] = [
			createElem("div", {
				innerHTML: SocraticTool.folder.CustomInstructions.Html,
			}),
			createElem("textarea", {
				id: "text_input",
				className: "fullWidth",
				style: { minHeight: "150px", minWidth: "100%" }
			}),
			createElem("p", {
				id: "unsaved",
				innerHTML: `<em>${unsavedResponseText}</em>`,
				style: { display: "none" },
			}),
			createElem("button", {
				id: "save",
				className: "btn btn-primary",
				disabled: true,
				textContent: saveButtonText,
			}),
			createElem("button", {
				id: "restore",
				className: "btn btn-secondary",
				textContent: useUnsavedResponseText,
			}),
		];

		let foundSubmission = false;

		save.addEventListener("click", () => {
			save.disabled = true;
			save.textContent = savingText;
			SocraticTool.response = input.value.replace(/"/gi, '\\"');
			SocraticTool.saveResponse();
		});

		restore.addEventListener("click", () => {
			save.disabled = false;
			restore.style.display = "none";
			unsaved.style.display = "block";
			input.value = localStorage["topic" + SocraticTool.topicID];
		});

		if (isStudentRole) {
			const submission =
				SocraticTool.submissions[0]?.Submissions[0]?.Comment.Text;
			if (submission) {
				foundSubmission = true;
				SocraticTool.response = submission;
				input.value = submission;
			}

			if (!foundSubmission) {
				const prepopData = questionTool.getAttribute("data-prepop");
				if (prepopData) input.value = prepopData;
				questionTool.append(unsaved, save);
			}

			if (localStorage["topic" + SocraticTool.topicID]) {
				input.value = localStorage["topic" + SocraticTool.topicID];
				// questionTool.append(restore);
			}

			input.addEventListener("keyup", () => {
				if (SocraticTool.detectChanges()) {
					save.disabled = false;
					unsaved.style.display = "block";
				} else {
					save.disabled = true;
					unsaved.style.display = "none";
				}
			});
		} else {
			save.disabled = true;
			save.style.display = "none";
			input.textContent = "[USER RESPONSE FIELD]";
		}

		questionTool.prepend(instructions, input);

		window.addEventListener("beforeunload", SocraticTool.cacheResponse);
	}

	if (data.type === "reference") {
		const instructions = createElem("div", {
			innerHTML: data.folder.CustomInstructions.Html,
		});
		const response = createElem("div", {
			innerHTML: `<em>${noResponseGivenText}</em>`,
		});

		if (
			document.getElementById(data.id).getAttribute("data-instructions") ===
			"true"
		) {
			instructions.innerHTML = data.folder.CustomInstructions.Html;
		}

		if (isStudentRole) {
			const submission = data.submissions[0]?.Submissions[0]?.Comment.Text;
			if (submission) {
				const responseText = submission.replace(/\n/g, "<br>");
				response.innerHTML = responseText;
			}
		} else {
			response.textContent = "[PREVIOUS USER RESPONSE]";
		}
		const referenceElement = document.getElementById(data.id);
		referenceElement.append(instructions, response);
	}
};
// updateReport: Builds and updates the report content for download.
SocraticTool.updateReport = function () {
	const isStudentRole = SocraticTool.roles.includes(
		SocraticTool.enrollments.Access.ClasslistRoleName
	);
	const questionReport = document.getElementById("questionReport");

	const [reportContent, download] = [
		createElem("div", { id: "reportContent" }),
		createElem("a", {
			id: "download",
			className: "btn btn-primary",
			role: "button",
			tabindex: "0",
			textContent: downloadText,
		}),
	];

	download.addEventListener("click", SocraticTool.saveReport);
	questionReport.append(reportContent);

	SocraticTool.reportTopics.forEach((reportTopic) => {
		const refTitleMatch = reportTopic.match(/\[([a-z0-9\s]+)\]/i);
		const refTitle = refTitleMatch ? refTitleMatch[1] : null;
		const refTopic = refTitle ? SocraticTool.getTopic(refTitle) : null;
		const reference = refTopic
			? createElem("p", {
					innerHTML: `<em>(Please refer back to ${refTopic.Title})</em>`,
			  })
			: null;
		const topicTitle = reportTopic.replace(/\[[a-z0-9\s]*\]/gi, "");
		const topic = SocraticTool.getTopic(topicTitle);

		if (topic) {
			const folder = SocraticTool.getFolder(topic.Title);
			const id = topic.Identifier;

			const [heading, instructions, response] = [
				createElem("h3", {
					className: "reportHeading",
					textContent: topic.Title,
				}),
				createElem("p", { innerHTML: folder.CustomInstructions.Html }),
				createElem("div", { id: `response_${id}` }),
			];

			if (folder) {
				reportContent.append(heading, reference, instructions, response);
			}

			if (isStudentRole) {
				libVal.get.submissions(
					SocraticTool.ouID,
					folder.Id,
					{},
					SocraticTool.addSubmission,
					{ id: id }
				);
			} else {
				response.innerHTML = "<br>[PREVIOUS USER RESPONSE]<br><br>";
			}
		}
	});

	const reportHeadings = document.querySelectorAll(".reportHeading");
	reportHeadings.forEach((heading, idx) => {
		if (idx !== 0) {
			const dividerClone = document.createElement("hr");
			heading.parentElement.insertBefore(dividerClone, heading);
		}
	});

	if (reportHeadings.length > 0) {
		questionReport.append(download);
	}
};
// addSubmission: Adds a submission to the report.
SocraticTool.addSubmission = function (data, storage) {
	const responseText =
		data.length > 0 && data[0].Submissions[0].Comment.Text !== ""
			? data[0].Submissions[0].Comment.Html
			: `<p><em>${noResponseGivenText}</em></p>`;
	const response = responseText.replace(/\n/g, "<br>");
	const responseElement = document.getElementById(`response_${storage.id}`);
	responseElement.innerHTML = response;

	responseElement.prepend(createElem("br"));
	responseElement.append(createElem("br"), createElem("br"));
};
// saveReport: Saves the report as a Word document.
SocraticTool.saveReport = function () {
	const header = `
	  <html xmlns:o='urn:schemas-microsoft-com:office:office'
		xmlns:w='urn:schemas-microsoft-com:office:word'
		xmlns='http://www.w3.org/TR/REC-html40'>
	  <head><meta charset='utf-8'><title>${reflectionReportText}</title></head><body>`;
	const footer = `</body></html>`;
	const sourceHTML = `${header}${
		document.getElementById("reportContent").innerHTML
	}${footer}`;
	const source = `data:application/vnd.ms-word;charset=utf-8,${encodeURIComponent(
		sourceHTML
	)}`;

	const fileDownload = document.createElement("a");
	document.body.appendChild(fileDownload);
	fileDownload.href = source;
	fileDownload.download = `${reflectionReportText} - ${new Date().getTime()}.doc`;
	fileDownload.click();
	document.body.removeChild(fileDownload);
};
// saveResponse: Saves the response to the server.
SocraticTool.saveResponse = function () {
	let fileArray, blob;
	let template = templates.uploadDropbox;

	template = template
		.replace("fname", "submission.txt")
		.replace("ftype", "text/html")
		.replace("fdesc", SocraticTool.response)
		.replace("fhtml", SocraticTool.response);
	fileArray = template.split("~");
	fileArray[1] = SocraticTool.response;

	blob = new Blob(fileArray);

	libVal.post.mySubmissions(
		SocraticTool.ouID,
		SocraticTool.folderID,
		blob,
		SocraticTool.savedResponse
	);
};
// savedResponse: Updates the UI after the response has been saved.
SocraticTool.savedResponse = function () {
	const saveButton = document.getElementById("save");
	saveButton.textContent = savedButtonText;

	const unsavedElement = document.getElementById("unsaved");
	unsavedElement.style.display = "none";
	const restoreElement = document.getElementById("restore");
	if (restoreElement) {
		restoreElement.remove();
	}

	delete localStorage["topic" + SocraticTool.topicID];
};

SocraticTool.getOrgId = function () {
	const pathname = window.top.location.pathname;
	const orgId = pathname.split("/")[4];

	return orgId;
};

SocraticTool.getTopicId = function () {
	let href = window.top.location.href;
	let topicId;

	if (href.indexOf("enhancedSequenceViewer") !== -1) {
		href = decodeURIComponent(href);
		href = href.split("?url=")[1];
		href = href.split("?")[0];

		topicId = href.split("/")[5];
	} else {
		topicId = href.split("/")[8];
	}

	return topicId;
};

SocraticTool.getTopic = function (topicTitle) {
	const topic = SocraticTool.topicList.find(
		(topic) =>
			topic.Title.replace(/^\s*/g, "").replace(/\s+$/g, "") === topicTitle
	);

	if (topic !== undefined) {
		return topic;
	}

	return null;
};

SocraticTool.getFolder = function (title) {
	for (const folder of SocraticTool.folders) {
		if (folder.Name.replace(/^\s+|\s+$/g, "") === title) {
			return folder;
		}
	}

	return null;
};

SocraticTool.getSubmission = function (title) {
	for (const folder of SocraticTool.folders) {
		if (folder.Name === title) {
			return folder;
		}
	}

	return null;
};

SocraticTool.detectChanges = function () {
	const textInput = document.getElementById("text_input");
	const questionTool = document.getElementById("questionTool");
	if (
		textInput.value !== SocraticTool.response &&
		textInput.value !== questionTool.getAttribute("data-prepop") &&
		textInput.value !== ""
	) {
		return true;
	}

	return false;
};

SocraticTool.cacheResponse = function () {
	console.log("Caching...");

	if (SocraticTool.detectChanges() === true) {
		localStorage["topic" + SocraticTool.topicID] =
			document.getElementById("text_input").value;
	} else {
		delete localStorage["topic" + SocraticTool.topicID];
	}
};

document.addEventListener("DOMContentLoaded", function () {
	SocraticTool.ouID = SocraticTool.getOrgId();
	SocraticTool.topicID = SocraticTool.getTopicId();
	libVal.get.myEnrollmentsOrg(SocraticTool.ouID, SocraticTool.init);
});
