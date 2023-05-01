# BrightSpace2Docx

This is a Node.js script to convert BrightSpace course exports into standalone HTML or DOCX files. The script processes images, including SVGs, and embedded quizzes. It also combines multiple HTML files into a single HTML or DOCX file, keeping the original file structure and styling intact.

## Dependencies

The following dependencies are required to run this script:

- fs
- html-docx-js
- xml2js
- cheerio
- he
- headReplace
- sharp
- path
- mime
- Adm-Zip
- os
- rimraf
- readline
- node-fetch

To install these dependencies, run the following command in your terminal:

```
npm install
```

## Usage

To run the script, execute the following command in your terminal:

```
setup.cmd
```
it will the install all dependencies if they are not present and close. Run it again and a window will appear.
Drag/drop the zip package in the window and press enter.

### or

```
node index.js <path-to-zip-file>
```

Replace `<path-to-zip-file>` with the path to the BrightSpace course export ZIP file you want to convert.

When the script runs, it will prompt you to choose the output file format (HTML or DOCX). Enter "html" or "docx" and press enter.

The script will generate a single output file, either in HTML or DOCX format, in the same directory as the script.

## Limitations

This script only works with BrightSpace course exports that follow the expected file structure. If the course export is incomplete or contains unexpected elements, the script may not work as intended.

Additionally, the script may not handle all types of media or interactive elements. Please verify the output file's content to ensure accuracy.

## Contributing

If you find any issues or have suggestions for improvements, please open an issue or submit a pull request on the repository.

## License

This project is licensed under the MIT License.
