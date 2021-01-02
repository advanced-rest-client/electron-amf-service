/* eslint-disable arrow-body-style */
import fs from 'fs-extra';
import path from 'path';

/** @typedef {import('../types').ApiSearchCandidate} ApiSearchCandidate */
/** @typedef {import('../types').ApiSearchTypeResult} ApiSearchTypeResult */

/**
 * Searches for API main file in given location
 */
export class ApiSearch {
  /**
   * @param {string} dir API directory location
   */
  constructor(dir) {
    this._workingDir = dir;
  }

  /**
   * Finds main API name.
   *
   * If one of the files is one of the popular names for the API spec files
   * then it always returns this file.
   *
   * If it finds single candidate it returns it as a main file.
   *
   * If it finds more than a single file it means that the user has to decide
   * which one is the main file.
   *
   * If it returns undefined than the process failed and API main file cannot
   * be determined.
   *
   * @return {Promise<Array<String>|String|undefined>}
   */
  async findApiFile() {
    const items = await fs.readdir(this._workingDir);
    const popularNames = ['api.raml', 'api.yaml', 'api.json'];
    const exts = ['.raml', '.yaml', '.json'];
    const ignore = ['__macosx', 'exchange.json', '.ds_store'];
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const lower = items[i].toLowerCase();
      if (ignore.indexOf(lower) !== -1) {
        continue;
      }
      if (popularNames.indexOf(lower) !== -1) {
        return item;
      }
      const ext = path.extname(lower);
      if (exts.indexOf(ext) !== -1) {
        files.push(item);
      }
    }
    if (files.length === 1) {
      return files[0];
    }
    if (files.length) {
      return this._decideMainFile(files);
    }
  }

  /**
   * Decides which file to use as API main file.
   * @param {string[]} files A file or list of files.
   * @return {Promise<string|string[]>}
   */
  async _decideMainFile(files) {
    const root = this._workingDir;
    const fullPathFiles = /** @type ApiSearchCandidate[] */ (files.map((item) => {
      return {
        absolute: path.join(root, item),
        relative: item,
      };
    }));
    const list = await this._findWebApiFile(fullPathFiles);
    if (!list) {
      return files;
    }
    return list;
  }

  /**
   * Reads all files and looks for 'RAML 0.8' or 'RAML 1.0' header which
   * is a WebApi.
   * @param {ApiSearchCandidate[]} files List of candidates
   * @param {string[]=} results List od results
   * @return {Promise<string|string[]|undefined>}
   */
  async _findWebApiFile(files, results=[]) {
    const f = files.shift();
    if (!f) {
      if (!results.length) {
        results = undefined;
      }
      if (results && results.length === 1) {
        return results[0];
      }
      return results;
    }
    try {
      const type = await this._readApiType(f.absolute);
      if (type && type.type) {
        results[results.length] = f.relative;
      }
      return await this._findWebApiFile(files, results);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Unable to find file type', e);
    }
  }

  /**
   * Reads API type from the API main file.
   * @param {string} file File location
   * @return {Promise<ApiSearchTypeResult>}
   */
  async _readApiType(file) {
    const size = 100;
    // todo (pawel): This works 100% for RAML files as they have to have a
    // type and version in the file header. However JSON OAS can have version
    // definition anywhere in the JSON object. It works for lot of APIs
    // but it may be broken for some APIs.
    // It should read and parse JSON files and look for the version value.
    // Leaving it here for performance reasons.
    const fd = await fs.open(file, 'r');
    const result = await fs.read(fd, Buffer.alloc(size), 0, size, 0);
    await fs.close(fd);
    const data = result.buffer.toString().trim();
    if (data[0] === '{') {
      // OAS 1/2
      const match = data.match(/"swagger"(?:\s*)?:(?:\s*)"(.*)"/im);
      if (!match) {
        throw new Error('Expected OAS but could not find version header.');
      }
      const v = match[1].trim();
      return {
        type: `OAS ${v}`,
        contentType: 'application/json',
      };
    }
    const oasMatch = data.match(/(?:openapi|swagger)[^\s*]?:(?:\s*)("|')?(\d\.\d)("|')?/im);
    if (oasMatch) {
      const v = oasMatch[2].trim();
      return {
        type: `OAS ${v}`,
        contentType: 'application/yaml',
      };
    }
    const header = data.split('\n')[0].substr(2).trim();
    if (!header || header.indexOf('RAML ') !== 0) {
      throw new Error('The API file header is unknown');
    }
    if (header === 'RAML 1.0' || header === 'RAML 0.8') {
      return {
        type: header,
        contentType: 'application/raml',
      };
    }
    switch (header) {
      case 'RAML 1.0 Overlay':
      case 'RAML 1.0 Extension':
      case 'RAML 1.0 DataType':
      case 'RAML 1.0 SecurityScheme':
      case 'RAML 1.0 Trait':
      case 'RAML 1.0 Library':
      case 'RAML 1.0 NamedExample':
      case 'RAML 1.0 DocumentationItem':
      case 'RAML 1.0 ResourceType':
      case 'RAML 1.0 AnnotationTypeDeclaration':
        return {
          type: 'RAML 1.0',
          contentType: 'application/raml',
        };
    }
    throw new Error('Unsupported API file');
  }
}
