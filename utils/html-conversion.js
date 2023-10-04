const cheerio = require('cheerio');
const officegen = require('officegen');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const wordStyleMapping = {
  // Typography
  'font-family': (value) => `font-family: ${value};`,
  'font-size': (value) => `font-size: ${value};`,
  'font-weight': (value) => value === 'bold' ? 'font-weight: bold;' : '',
  'font-style': (value) => value === 'italic' ? 'font-style: italic;' : '',
  'text-transform': (value) => `text-transform: ${value};`, // May require additional processing
  'text-decoration': (value) => `text-decoration: ${value};`, // Includes underline, overline, line-through
  'letter-spacing': (value) => `letter-spacing: ${value};`, // Requires Word support or manual adjustment
  'line-height': (value) => `line-height: ${value};`,
  'text-align': (value) => `text-align: ${value};`,
  'text-indent': (value) => `text-indent: ${value};`,
  'text-shadow': (value) => {}, // No direct equivalent, may simulate with Word Art or other tools
  // Color and Background
  'color': (value) => `color: ${value};`,
  'background-color': (value) => `background-color: ${value};`,
  'background-image': (value) => {}, // No direct equivalent, may require embedding images
  // Box Model
  'margin': (value) => `margin: ${value};`,
  'padding': (value) => `padding: ${value};`,
  'border': (value) => `border: ${value};`,
  'border-radius': (value) => {}, // No direct equivalent, may require special table cell formatting or images
  'box-shadow': (value) => {}, // No direct equivalent, may simulate with images or other creative methods
  'width': (value) => `width: ${value};`,
  'height': (value) => `height: ${value};`,
  'float': (value) => `float: ${value};`,
  // Positioning
  'position': (value) => {}, // No direct equivalent, may need to use text boxes or other layout tools
  'top': (value) => {}, // No direct equivalent, relates to CSS positioning
  'right': (value) => {}, // No direct equivalent, relates to CSS positioning
  'bottom': (value) => {}, // No direct equivalent, relates to CSS positioning
  'left': (value) => {}, // No direct equivalent, relates to CSS positioning
  'z-index': (value) => {}, // No direct equivalent, may need to manage layering manually
  // Tables
  'border-collapse': (value) => `border-collapse: ${value};`,
  'border-spacing': (value) => `border-spacing: ${value};`,
  'caption-side': (value) => `caption-side: ${value};`,
  // Paged Media
  'page-break-before': (value) => value === 'always' ? 'page-break-before: always;' : '',
  'page-break-after': (value) => value === 'always' ? 'page-break-after: always;' : '',
  // Transitions and Animations
  'transition': (value) => {}, // No direct equivalent in static Word documents
  'animation': (value) => {}, // No direct equivalent in static Word documents
};

const traverseTable = (tableElement, parent) => {
  const tableStyle = applyStyles(tableElement);
  const table = parent.createTable({ style: tableStyle }); // You may want to define Word table styles here

  tableElement.find('tr').each((i, row) => {
    const tableRow = table.createRow();
    $(row).find('td, th').each((j, cell) => {
      const content = $(cell).text();
      const cellStyle = applyStyles($(cell));
      const rowspan = $(cell).attr('rowspan');
      const colspan = $(cell).attr('colspan');
      // Add the cell to the row
      const tableCell = tableRow.createCell(content, {
        style: cellStyle,
        rowspan: rowspan ? parseInt(rowspan) : undefined,
        colspan: colspan ? parseInt(colspan) : undefined,
      });
      // Additional cell properties and styling can be applied here
    });
  });
};


// Additional properties and handling methods may be needed
const traverseList = (listElement, parent, level = 0) => {
  listElement.children('li').each((i, listItem) => {
    const content = $(listItem).text();
    const listStyle = applyStyles($(listItem));
    
    // Determine the list type and set numbering and indentation accordingly
    const isOrdered = listElement.is('ol');
    const indentLevel = level * 720; // 720 is a common TWIP value for one level of indentation in Word
    const numberingStyle = isOrdered ? { level: level } : null;

    // Create a paragraph representing the list item
    const listItemObj = parent.createP();
    listItemObj.addText(content, { ...listStyle, indent: indentLevel });
    if (numberingStyle) {
      listItemObj.options.numbering = numberingStyle; // Apply numbering if it's an ordered list
    }

    // Check for nested lists and process recursively
    $(listItem).children('ul, ol').each((j, nestedList) => {
      traverseList($(nestedList), parent, level + 1); // Process nested list with increased level
    });
  });
};


const convertHtmlToDocx = (html) => {
  const $ = cheerio.load(html);
  const docx = officegen('docx');

  const traverseNode = (node, parent) => {
    node.children.forEach((child) => {
      switch (child.tagName) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          const headingLevel = parseInt(child.tagName.substr(1));
          const headingStyle = applyStyles($(child));
          parent.title({ p: $(child).text(), level: headingLevel, style: headingStyle });
          break;
        case 'p':
          const paragraphStyle = applyStyles($(child));
          parent.paragraph({ p: $(child).text(), style: paragraphStyle });
          break;
        case 'ul':
        case 'ol':
          traverseList($(child), parent);
          break;
        case 'table':
          traverseTable($(child), parent);
          break;
        case 'div':
          const section = parent.createSection({ /* section properties */ });
          traverseNode(child, section);
          break;
        // Additional cases for other HTML elements
        default:
        // Default case to handle unsupported tags
        const content = $(child).text();
        if (content.trim() !== '') {
          const paragraph = parent.createP();
          paragraph.addText(content); // Add content as plain text
        }
        // Check for children and traverse them
        if (child.children.length > 0) {
          traverseNode(child, parent);
        }
        break;
      }
    });
  };

  const applyStyles = (element) => {
    const styles = {};
    const cssStyles = element.css(); // Assuming inline CSS styles
    for (const prop in cssStyles) {
      const mappingFunction = wordStyleMapping[prop];
      if (mappingFunction) {
        styles[prop] = mappingFunction(cssStyles[prop]);
      }
    }
    return styles;
  };


  traverseNode($('body'), docx);

   // Write the DOCX file
  const stream = fs.createWriteStream('file.docx');
  docx.generate(stream);
};
