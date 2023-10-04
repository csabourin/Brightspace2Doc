const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const mime = require("mime");

const findFileInDir = (dir, filename) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const found = findFileInDir(filePath, filename);
      if (found) return found;
    } else if (path.basename(file) === filename) {
      return filePath;
    }
  }

  return null;
};

const constructLocalUrl = (src, localBrightspaceUrl) => {
  if (
    src.startsWith("/shared/LCS_HTML_Templates/") ||
    src.startsWith(`/d2l/common/`)
  ) {
    return localBrightspaceUrl + src;
  }
  return src;
};

const replaceContentEnforcedPath = (src, localBrightspaceUrl) => {
  let regexPattern;
  if (src.startsWith(localBrightspaceUrl + "/content/enforced/")) {
    regexPattern = new RegExp("^" + localBrightspaceUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "/content/enforced/[^/]+/");
    src = src.replace(regexPattern, "");
  }

  if (src.startsWith("/content/enforced/")) {
    regexPattern = new RegExp("/content/enforced/[^/]+/");
    src = src.replace(regexPattern, "");
  }

  return src;
};

const removeUrlParameters = (src) => {
  return src.split("?")[0];
};

const resolveAbsolutePath = (src, directoryPath) => {
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src; // Already an absolute URL
  }

  if (src.startsWith("../")) {
    src = src.substring(3);
  }

  const absoluteSrc = path.resolve(directoryPath, src);
  return decodeURIComponent(absoluteSrc);
};


const embedImages = async ($, htmlFilePath, localBrightspaceUrl) => {
  const images = $("img");
  const directoryPath = path.dirname(htmlFilePath);

  for (let i = 0; i < images.length; i++) {
    const img = images.eq(i);
    let src = img[0].attribs.src;
    if (src === undefined) {
      continue;
    }

    src = constructLocalUrl(src, localBrightspaceUrl);
    src = replaceContentEnforcedPath(src, localBrightspaceUrl);
    src = removeUrlParameters(src);
    src = resolveAbsolutePath(src, directoryPath);

    try {
      const base64Data = await urlToBase64(src, localBrightspaceUrl);
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

const urlToBase64 = async (url, localBrightspaceUrl, tempDir) => {
  // Check if the URL starts with "/shared/LCS_HTML_Templates/" and prepend the domain
  if (
    url.startsWith("/shared/LCS_HTML_Templates/") ||
    url.startsWith(`/d2l/common/`)) {
    url = localBrightspaceUrl + url;
  }

  // Remove URL parameters
  url = url.split("?")[0];

  // Check if the URL is remote
  const isRemote = url.startsWith("http") || url.startsWith("https");

  // Utility to convert SVG to PNG Buffer
  const convertSvgToPng = async (inputBuffer) => {
    let result;
    try {
      try {
        result = inputBuffer;
      } catch (error) {
        console.error("Invalid SVG:", error);
        return null; // Return null when an SVG is invalid
      }
      const pngBuffer = await sharp(result).png().toBuffer();
      return pngBuffer;
    } catch (error) {
      console.error("Error converting SVG to PNG");
      return null; // Return null when an error occurs during conversion
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
      const convertedBuffer = await convertSvgToPng(buffer);
      if (convertedBuffer === null) {
        console.warn("Skipping invalid SVG");
        return ""; // Return an empty string when the SVG is invalid
      }
      buffer = convertedBuffer;
    }

    // Only continue if the buffer is not null
    if (buffer !== null) {
      const base64 = buffer.toString("base64");
      return `data:image/png;base64,${base64}`;
    } else {
      return "";
    }
  } else // if file is not Remote
  {
    url = url.replace('.//', '/');
    const decodedUrl = decodeURI(url); // Decode the URL in case it contains spaces or other special characters
    const absoluteSrc = decodedUrl.startsWith(tempDir)
      ? path.resolve(decodedUrl)
      : path.resolve(tempDir, decodedUrl);
    const correctedPath = absoluteSrc.replace(/\\/g, "/");

   return new Promise((resolve, reject) => {
  fs.readFile(correctedPath, async (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        console.warn(`File not found, trying tempDir: ${absoluteSrc}`);

        // Try to read from tempDir
        let tempPath = "";
        if (tempDir && path.basename(correctedPath)) {
          tempPath = path.resolve(tempDir, path.basename(correctedPath));
        }

        if (tempPath) {
          fs.readFile(tempPath, async (tempError, tempData) => {
            if (tempError) {
              console.warn(`File not found in tempDir either, skipping: ${tempPath}`);
              resolve(""); // resolve with an empty string or a placeholder image data URL
            } else {
              // Process tempData as found in tempDir
              const mimeType = mime.getType(tempPath);
              const isSvg = tempPath.toLowerCase().endsWith(".svg");
              if (isSvg) {
                const convertedData = await convertSvgToPng(tempData);
                if (convertedData === null) {
                  console.warn(`Invalid SVG, skipping: ${tempPath}`);
                  resolve("");
                  return;
                }
                tempData = convertedData;
              }

              if (tempData !== null) {
                const base64 = tempData.toString("base64");
                const final = `data:${isSvg ? "image/png" : mimeType};base64,${base64}`;
                resolve(final);
              } else {
                resolve("");
              }
            }
          });
        } else {
          console.warn(`File not found in tempDir either, skipping: ${correctedPath}`);
          resolve("");
        }
      } else {
        console.error(`Error converting image to base64: ${absoluteSrc}`);
        reject(error);
      }
    } else {
      const mimeType = mime.getType(absoluteSrc);
      const isSvg = absoluteSrc.toLowerCase().endsWith(".svg");

      if (isSvg) {
        const convertedData = await convertSvgToPng(data);
        if (convertedData === null) {
          console.warn(`Invalid SVG, skipping: ${absoluteSrc}`);
          resolve(""); // resolve with an empty string when the SVG is invalid
          return; // Exit the readFile callback
        }
        data = convertedData;
      }

      // Only continue if the data is not null
      if (data !== null) {
        const base64 = data.toString("base64");
        const final = `data:${isSvg ? "image/png" : mimeType};base64,${base64}`;
        resolve(`${final}`);
      } else {
        resolve("");
      }
    }
  });
});

  }
};

const svgStringToPngBuffer = async (svgString) => {
  try {
    return await sharp(Buffer.from(svgString)).png().toBuffer();
  } catch (error) {
    console.error(`Error converting SVG to PNG: ${error.message}`);
    return null; // or handle the error in another way
  }
};

module.exports = {
  embedImages,
  urlToBase64,
  svgStringToPngBuffer,
};
