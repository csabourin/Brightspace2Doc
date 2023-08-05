const debug = process.env.debug_mode || false;
let language = "en";
const fs = require("fs");
const xml2js = require("xml2js");
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
    if (debug) console.log("Processing section: ", section.$.ident);
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
      console.warn("No items or item references found in quiz XML section: ", section.$.ident);
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
  if (debug) console.log("492 Quiz items: ", items.length);
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
      const isShortAnswer = qmdQuestionTypeValue === "Short Answer";
      if (debug) console.log("521 Question Type: ", qmdQuestionTypeValue);

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
      } else if (isShortAnswer) {
        let question = item.presentation.flow.material.mattext._;
        let answerChoices = item.resprocessing.respcondition.map(
          (resp) => resp.conditionvar?.varequal?._
        );
        let feedback = item.itemfeedback.material.mattext._;

        quizData.push({
          questionType: "Short Answer",
          question: question,
          answerChoices: answerChoices,
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

const formatQuizDataAsHtml = (quizData, title, req) => {
  const extractQuizAnswers = req.session.extractQuizAnswers;
  console.log(extractQuizAnswers);
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
      quizHtml += "</ol></li>";
      if (extractQuizAnswers) {
        quizHtml += language.toString().startsWith("en")
          ? `<p>Correct Answer: ${correctAnswer}</p></li>`
          : `<p>Bonne réponse: ${correctAnswer}</p></li>`;

        quizHtml += feedbacks ? `<p>Feedback: ${feedbacks}</p>` : "";
      }
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
          if (extractQuizAnswers) {
            quizHtml += `<li>${option.text}${isCorrect ? " (Correct)" : ""
              }</li>`;
          }
        });
        quizHtml += "</ul>";
      });
      if (extractQuizAnswers) {
        quizHtml += `</ul><h2>Feedback</h2><p>${feedbacks}</p></li>`;
      }
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

module.exports = {
  parseItems,
  parseQuizXml,
  findItemByLabel,
  isCorrectChoice,
  formatQuizDataAsHtml,
  parseQuizXmlFile,
  readFile
}