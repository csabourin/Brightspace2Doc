const fs = require("fs");
const HTMLtoDOCX = require("html-to-docx");
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

const urlToBase64 = async (url) => {
  // Check if the URL is remote
  const isRemote = url.startsWith("http://") || url.startsWith("https://");

  if (isRemote) {
    const { default: fetch } = await import("node-fetch");
    const response = await fetch(url);
    const buffer = await response.buffer();
    const mimeType = mime.getType(url);
    const base64 = buffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  } else {
    const resolvedUrl = path.resolve(tempDir, url);
    const decodedUrl = decodeURIComponent(resolvedUrl); // Decode the URL in case it contains spaces or other special characters

    return new Promise((resolve, reject) => {
      fs.readFile(decodedUrl, (error, data) => {
        if (error) {
          if (error.code === "ENOENT") {
            console.warn(`File not found, ENOENT, skipping: ${url}`);
            resolve(""); // resolve with an empty string or a placeholder image data URL
          } else {
            console.error(`Error converting image to base64: ${url}`, error);
            reject(error);
          }
        } else {
          const mimeType = mime.getType(decodedUrl);
          const base64 = data.toString("base64");
          resolve(`data:${mimeType};base64,${base64}`);
        }
      });
    });
  }
};

const processZipFile = async (zipFilePath) => {
  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(tempDir, true);
  //   console.log(`Temporary directory created: ${tempDir}`);
  // console.log("Contents of the temporary directory:");
  // fs.readdirSync(tempDir).forEach((file) => {
  //   console.log(`  - ${file}`);
  // });
  const imsManifestPath = path.join(tempDir, "imsmanifest.xml");

  await processImsManifest(imsManifestPath);

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

const readFile = (path) => {
  return new Promise((resolve, reject) => {
    fs.readFile(path, "utf8", (err, content) => {
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

const processHtmlFiles = async (itemResourceMap, docxFileName) => {
  let combinedHtmlContent = "";
  let firstHeadTag = "";

  const embedImages = async ($, htmlFilePath) => {
    const images = $("img");
    for (let i = 0; i < images.length; i++) {
      const img = images.eq(i);
      const src = img[0].attribs.src;

      // Resolve the absolute path of the image
      const absoluteSrc = path.resolve(path.dirname(htmlFilePath), src);

      console.log(`Original src: ${src}`);
      console.log(`Resolved src: ${absoluteSrc}`);

      try {
        const base64Data = await urlToBase64(absoluteSrc);
        img.attr("src", `data:image/png;base64,${base64Data}`);
      } catch (err) {
        console.error(`File not found, skipping: ${absoluteSrc}`);
      }
    }
  };

  for (const [title, resourceData] of Object.entries(itemResourceMap)) {
    const { href, description } = resourceData;
    const htmlFilePath = path.join(tempDir, href); // Make sure you're using tempDir here
    const fileContent = href ? await readFile(htmlFilePath) : ""; // Use the updated path
    const $ = href ? cheerio.load(fileContent) : null;
    const bodyContent = $ ? $("body").html() : "";

    if (!firstHeadTag && $) {
      firstHeadTag = $("head").html();
    }

    if ($) {
      await embedImages($, htmlFilePath);
    }

    const decodedDescription = description ? decodeHtml(description) : "";
    const titleWithDescription = description
      ? `<h1>${title}</h1>\n${decodedDescription}\n`
      : "";

    combinedHtmlContent += `${titleWithDescription}${bodyContent}\n`;
  }

  const $ = cheerio.load(combinedHtmlContent);
  const images = $("img");
  const imagePromises = [];
  images.each((index, image) => {
    const img = $(image);
    const url = img.attr("src");
    const isSvg = url.toLowerCase().endsWith(".svg");

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
            )}`;
            img.attr("src", pngBase64DataUrl);
          })
          .catch((err) => {
            console.warn(`Error processing SVG image, skipping: ${url}`);
            console.warn(err.message);
          });
        imagePromises.push(promise);
      } else {
        const promise = urlToBase64(url).then((base64DataUrl) => {
          img.attr("src", base64DataUrl);
        });
        imagePromises.push(promise);
      }
    } catch (err) {
      console.error(`Error processing image, skipping image: ${url}`, err);
    }
  });

  await Promise.all(imagePromises);
  combinedHtmlContent = $.html();

  const resultHtml = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${headReplace}
    <title>BrightSpace2Docx</title>
  </head>
  <body>
    ${combinedHtmlContent}
  </body>
  </html>
    `;

  (async () => {
    try {
      const fileBuffer = await HTMLtoDOCX(resultHtml, null, {
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
      });

      fs.writeFile(docxFileName, fileBuffer, (error) => {
        if (error) {
          console.log("Docx file creation failed");
          return;
        }
        console.log("Docx file created successfully");
      });
    } catch (error) {
      console.error("Error converting HTML to DOCX:", error);
    }
  })();

  // const docx = htmlDocx.asBlob(resultHtml);
  // const buffer = Buffer.from(await docx.arrayBuffer());
  // fs.writeFile(docxFileName, buffer, (err) => {
  //   if (err) {
  //     console.error(`Error writing ${docxFileName}:`, err);
  //   } else {
  //     console.log(`${docxFileName} created successfully.`);
  //   }
  // });
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

const processImsManifest = async (imsManifestPath) => {
  const manifestContent = await readFile(imsManifestPath);
  const parser = new xml2js.Parser();
  const manifestJson = await parser.parseStringPromise(manifestContent);

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

  manifestJson.manifest.resources[0].resource.forEach((resource) => {
    const identifier = resource.$.identifier;
    const href = resource.$.href;
    const isHtmlResource = href && href.toLowerCase().endsWith(".html");
    resourceMap[identifier] = { href, isHtmlResource };
  });

  parseItems(organization.item, itemResourceMap, resourceMap);

  const titleElement =
    metadata["imsmd:title"]?.[0]?.["imsmd:langstring"]?.[0]._;
  const sanitizedTitle = sanitizeFilename(titleElement);
  const docxFileName = `${sanitizedTitle}.docx`;

  await processHtmlFiles(itemResourceMap, docxFileName);
};

const zipFilePath = process.argv[2]; // Get the zip file path from the command-line arguments

if (zipFilePath) {
  processZipFile(zipFilePath).catch((err) => {
    console.error("Error processing zip file:", err);
  });
} else {
  console.error("Please provide a zip file path as a command-line argument.");
}
