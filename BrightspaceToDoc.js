const debug = process.env.debug_mode || false;
const fs = require("fs");
const htmlDocx = require("html-docx-js");
const xml2js = require("xml2js");
const cheerio = require("cheerio");
const he = require("he");
const headReplace = require("./utils/headReplace");
const sharp = require("sharp");
const path = require("path");
const AdmZip = require("adm-zip");
const os = require("os");
const rimraf = require("rimraf");
let titleElement = "BrightspaceToDocx";
const express = require("express");
const session = require('express-session');
const app = express();
const port = process.env.PORT || 3000;
const offset = process.env.BS2DOC_OFFSET || '/';
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    const extension = path.extname(originalName);
    const nameWithoutExtension = path.basename(originalName, extension);
    const newName = `${nameWithoutExtension}-${timestamp}${extension}`;
    cb(null, newName);
  }
});

const upload = multer({ storage: storage });
let localBrightspaceUrl = process.env.bsurl || "https://app.csps-efpc.gc.ca";
const { embedImages, urlToBase64, svgStringToPngBuffer } = require('./utils/process-images');
const { parseItems,
  formatQuizDataAsHtml,
  readFile,
  parseQuizXmlFile } = require('./utils/process-quiz')

const processZipFile = async (zipFilePath, res, tempDir, req) => {
  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(tempDir, true);
  const imsManifestPath = path.join(tempDir, "imsmanifest.xml");
  await processImsManifest(imsManifestPath, res, tempDir, req);


  rimraf.sync(tempDir); // Delete temporary folder
};



const sanitizeFilename = (filename) => {
  if (typeof filename !== "string") {
    console.error("Invalid filename:", filename);
    filename = "default_filename";
  }
  // Replace illegal characters with a safe alternative
  return filename.replace(/[ <>:"/\\|?*]/g, "_");
};


const decodeHtml = (encodedHtml) => {
  return he.decode(String(encodedHtml));
};


const processHtmlFiles = async (
  itemResourceMap,
  docxFileName,
  quizHtmlContentMap,
  fileType,
  res,
  tempDir,
  req
) => {
  let combinedHtmlContent = "";
  let firstHeadTag = "";

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
      bodyContent = await embedImages($, htmlFilePath, localBrightspaceUrl, tempDir);
      const headContent = $("head").html();

      if (!firstHeadTag) {
        firstHeadTag = headContent;
      }
    }
    combinedHtmlContent += `${titleWithDescription}${bodyContent}\n`;
  }
  const processSvgElement = async (element, $) => {
    const svgString = $.html(element);
    return svgStringToPngBuffer(svgString)
      .then((buffer) => {
        if (buffer && buffer.length > 0) {
          const pngBase64DataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
          element.replaceWith(`<img src="${pngBase64DataUrl}"/>`);
        } else {
          console.error("Buffer is empty. SVG conversion failed.");
        }
      })
      .catch((err) => {
        console.error("Error processing SVG element:", err);
      });
  };

  const processSvgImage = async (url, element, tempDir) => {
    return urlToBase64(url, localBrightspaceUrl, tempDir)
      .then((base64DataUrl) => {
        if (!base64DataUrl || !base64DataUrl.startsWith("data:image/svg+xml;base64,")) {
          // Log the error or handle it as needed, then return to skip this file
          console.error(`Invalid or empty data URL: ${base64DataUrl}`);
          return;
        }

        return sharp(Buffer.from(base64DataUrl.split(",")[1], "base64"))
          .png()
          .toBuffer();
      })
      .then((buffer) => {
        if (buffer) {
          const pngBase64DataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
          element.attr("src", pngBase64DataUrl);
        }
      })
      .catch((err) => {
        // Log the error without stopping the program
        console.error(`Error processing SVG image: ${url}`, err);
      });
  };


  const processOtherImages = async (url, element, tempDir) => {
    return urlToBase64(url, localBrightspaceUrl, tempDir)
      .then((base64DataUrl) => {
        element.attr("src", base64DataUrl);
      });
  };

  const processImagesAndSvgs = async (combinedHtmlContent, tempDir) => {

    const $ = cheerio.load(combinedHtmlContent);
    const imagesAndSvgs = $("img, svg");
    const imagePromises = [];

    imagesAndSvgs.each((index, el) => {
      const element = $(el);
      const isSvgElement = el.tagName.toLowerCase() === "svg";
      const url = element.attr("src");

      if (isSvgElement) {
        imagePromises.push(processSvgElement(element, $, tempDir));
      } else if (url && url.toLowerCase().endsWith(".svg")) {
        imagePromises.push(processSvgImage(url, element, tempDir));
      } else if (url && url.startsWith("data:")) {
        // No processing needed for data URLs
      } else if (url) {
        imagePromises.push(processOtherImages(url, element, tempDir));
      }
    });

    await Promise.all(imagePromises);
    return $.html();
  };
  combinedHtmlContent = await processImagesAndSvgs(combinedHtmlContent, tempDir);


  const resultHtml = `
  <!DOCTYPE html>
  <html lang="${req.session.language}">
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

  if (fileType === "html") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=" + docxFileName.replace(".docx", ".html")
    );
    res.send(resultHtml);
  } else {

    const $ = cheerio.load(resultHtml);

    // Create the new element you want to append
    const pageBreakDiv = '<div class="page-break" style="page-break-after: always;"></div>';

    // Append the new element as the first child inside each <body> element
    $('title').each((index, bodyElement) => {
      $(bodyElement).prepend(pageBreakDiv);
    });

    // Find and remove nested <body> tags, but keep their content
    $('body body').each((index, nestedBody) => {
      $(nestedBody).replaceWith($(nestedBody).html());
    });

    // Move content of each <head> inside <body> to the first <head> element
    $('body head').each((index, nestedHead) => {
      const nestedHeadContent = $(nestedHead).html();
      $('head').first().append(nestedHeadContent);
      $(nestedHead).remove(); // Remove the nested head tag
    });

    const cleanedHtml = $.html();

    console.log("Size of html: ", cleanedHtml.length);

    const docx = htmlDocx.asBlob(cleanedHtml);
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


const processImsManifest = async (imsManifestPath, res, tempDir, req) => {
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
      const quizData = await parseQuizXmlFile(quizFilePath, tempDir);
      const quizHtmlContent = formatQuizDataAsHtml(quizData, title, req);
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
      const quizData = await parseQuizXmlFile(quizFilePath, tempDir);
      const quizHtmlContent = formatQuizDataAsHtml(quizData, title, req);
      quizHtmlContentMap[title] = quizHtmlContent;
    }
  }

  const titleElement =
    metadata["imsmd:title"]?.[0]?.["imsmd:langstring"]?.[0]._;
  req.session.language = metadata["imsmd:language"][0];
  const sanitizedTitle = sanitizeFilename(titleElement);
  if (debug) console.log("1016 Title: " + sanitizedTitle);
  const docxFileName = `${sanitizedTitle}.docx`;

  await processHtmlFiles(
    itemResourceMap,
    docxFileName,
    quizHtmlContentMap,
    fileType,
    res,
    tempDir,
    req
  );
};
let fileType;
app.use(offset, express.static("public"));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'BrightSpace2Docx',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true } // Use 'secure: true' if you are using HTTPS
}));
app.post(offset + "upload", upload.single("file"), (req, res) => {
  zipFilePath = req.file.path;
  fileType = req.body.fileType;
  req.session.extractQuizAnswers = req.body.extractQuizAnswers;
  req.session.language = "en-ca";
  if (zipFilePath) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs2docx-"));
    processZipFile(zipFilePath, res, tempDir, req).catch((err) => {
      console.error("Error processing zip file:", err);
      res
        .status(500)
        .send({ message: "Error processing the file.", error: err.message });
    });
  } else {
    console.error("Please provide a zip file to process.");
    res
      .status(400)
      .send({ message: "No file uploaded. Please provide a zip file." });
  }
});

app.listen(port, () => {
  const options = { timeZone: 'America/New_York', hour12: false };
  const startTime = new Date().toLocaleTimeString('en-CA', options);
  console.log('Server started at:', startTime);
  console.log(`Server is listening on port ${port}`);

});
