import { file, dir } from 'tmp-promise';
import { Duplex } from 'stream';
import unzipper from 'unzipper';
import path from 'path';
import { fork } from 'child_process';
import fs from 'fs-extra';
import { ApiSearch } from './ApiSearch.js';

/** @typedef {import('../types').AmfServiceProcessingOptions} AmfServiceProcessingOptions */
/** @typedef {import('../types').ApiSearchTypeResult} ApiSearchTypeResult */
/** @typedef {import('../types').ApiParseResult} ApiParseResult */
/** @typedef {import('tmp-promise').FileResult} FileResult */
/** @typedef {import('tmp-promise').DirectoryResult} DirectoryResult */
/** @typedef {import('child_process').ChildProcess} ChildProcess */

/**
 * A class that handles parsing a file to AMF format.
 *
 * It unpacks zip files, searches for main entry point to the API and parses
 * the data to AMF json-ld format.
 *
 * The process can be split into 3 parts:
 *
 * - prepare - unzips the file to a temporary location, sets paths
 * - resolve - in case when deterministic method of finding API main file fails, the application should aks a user to choose the main API file.
 * - parse - parsing API data and returning AMF model.
 *
 * Example use:
 *
 * ```javascript
 * const service = new AmfService(filePathOrBuffer);
 *
 * service.prepare()
 * .then(() => service.resolve())
 * .then((candidates) => {
 *  // If "candidates" is set then the application
 *  // should ask the user to select main file
 *  if (candidates) {
 *    return askUser(candidates);
 *  } else {
 *    return service.parse();
 *  }
 * })
 * .then((mainFile) => service.parse(mainFile))
 * .then((model) => console.log(model))
 * .catch((cause) => console.error(cause));
 * ```
 */
export class AmfService {
  /**
   * True when tmp object represents a file and not a directory
   * @type {boolean}
   */
  #tmpIsFile = false;

  /**
   * @return {boolean} True when tmp object represents a file and not a directory
   */
  get tmpIsFile() {
    return this.#tmpIsFile;
  }

  /**
   * The same as with constructor but resets the sate.
   * @param {Buffer|string} source Location of the API file on the disk or
   * buffer of the file. If the source is a file and it's not a zip file then
   * it must be the API file.
   * @param {AmfServiceProcessingOptions=} [opts={}] Processing options
   */
  setSource(source, opts={}) {
    this.source = source;
    this.isZip = opts.zip;
    this.validate = opts.validate;

    /**
     * Temp folder data object.
     * @type {FileResult|DirectoryResult}
     */
    this.tmpObj = undefined;
    /**
     * A directory path where files are stored.
     * @type {string}
     */
    this.workingDir = undefined;
    /**
     * API main file (entry point) in the working directory.
     * If this is set it means the files has been resolved.
     * @type {string}
     */
    this.mainFile = undefined;
  }

  /**
   * Cleans up if the operation is canceled.
   * This must be called if `prepare()` was called or otherwise some temporary
   * files will be kept on the disk.
   * @return {Promise<void>}
   */
  async cancel() {
    await this._cleanTempFiles();
    this.tmpObj = undefined;
    this.workingDir = undefined;
    this.mainFile = undefined;
  }

  /**
   * Cleans up temporary directories and kills all child processes.
   * @return {Promise<void>}
   */
  async cleanup() {
    this._cancelMonitorParser();
    this._cancelParseProcTimeout();
    const proc = this._parserProc;
    if (!proc) {
      return this.cancel();
    }
    return new Promise((resolve) => {
      this._killParser();
      proc.on('exit', () => {
        this.cancel().then(() => resolve());
      });
    });
  }

  /**
   * Prepares the file to be processed.
   * @return {Promise<void>}
   */
  async prepare() {
    if (this.isZip) {
      return this._prepareZip();
    }
    if (this.source instanceof Buffer) {
      return this._prepareBuffer();
    }
    const stat = await fs.stat(this.source);
    if (stat.isDirectory()) {
      this.workingDir = this.source;
    } else {
      this.workingDir = path.dirname(this.source);
      this.mainFile = path.basename(this.source);
    }
  }

  /**
   * Prepares zip files to be processed. Unzips un "unfolders" the
   * content of the zip.
   * @return {Promise<void>}
   */
  async _prepareZip() {
    try {
      await this._unzipSource();
    } catch (cause) {
      await this._cleanTempFiles();
      throw cause;
    }
  }

  /**
   * Prepares buffer data to be processed.
   * @return {Promise<void>}
   */
  async _prepareBuffer() {
    const location = await this._tmpBuffer(/** @type Buffer */ (this.source));
    this.workingDir = path.dirname(location);
    this.mainFile = path.basename(location);
  }

  /**
   * Resolves the API structure and tries to find main API file.
   *
   * @param {string=} mainFile API main file if known.
   * @return {Promise<string[]>} If promise resolves to an array it means that API type could not be determined automatically.
   */
  async resolve(mainFile) {
    if (this.#tmpIsFile) {
      return;
    }
    if (!this.workingDir) {
      await this._cleanTempFiles();
      throw new Error(`prepare() function not called`);
    }
    if (this.mainFile) {
      return;
    }
    if (mainFile) {
      const file = path.join(this.workingDir, mainFile);
      const exists = fs.pathExists(file);
      if (exists) {
        this.mainFile = mainFile;
        return;
      }
      throw new Error('API main file does not exist.');
    }
    const search = new ApiSearch(this.workingDir);
    try {
      const result = await search.findApiFile();
      if (!result) {
        throw new Error('Unable to find API files in the source location');
      }
      if (Array.isArray(result)) {
        return result;
      }
      this.mainFile = result;
    } catch (cause) {
      await this._cleanTempFiles();
      throw cause;
    }
  }

  /**
   * Parses API data using AMF parser.
   * @param {string=} mainFile Main API file to use.
   * @return {Promise<ApiParseResult>} A promise resolved to AMF model.
   */
  async parse(mainFile) {
    if (!this.workingDir) {
      await this._cleanTempFiles();
      throw new Error(`prepare() function not called`);
    }
    if (mainFile && typeof mainFile === 'string') {
      this.mainFile = mainFile;
    }
    if (!this.mainFile) {
      await this._cleanTempFiles();
      throw new Error(`resolve() function not called`);
    }
    const search = new ApiSearch(this.workingDir);
    const apiLocation = path.join(this.workingDir, this.mainFile);
    try {
      const type = await search._readApiType(apiLocation);
      const model = await this._runParser(apiLocation, type);
      await this._cleanTempFiles();
      return {
        model,
        type,
      };
    } catch (cause) {
      await this._cleanTempFiles();
      throw cause;
    }
  }

  /**
   * Unzips the source to a tem folder.
   * @return {Promise<void>}
   */
  async _unzipSource() {
    let buffer;
    if (this.source instanceof Buffer) {
      buffer = this.source;
    } else {
      buffer = await fs.readFile(this.source);
    }
    const location = await this._unzip(buffer);
    this.workingDir = location;
    await this._removeZipMainFolder(location);
  }

  /**
   * Creates a temporary file.
   * @param {Buffer} buffer A buffer to use to write the data to the temp file
   * @return {Promise<string>}
   */
  async _tmpBuffer(buffer) {
    const tmp = await file();
    this.tmpObj = tmp;
    this.#tmpIsFile = true;
    const fd = tmp.fd;
    await fs.write(fd, buffer);
    await fs.close(fd);
    return tmp.path;
  }

  /**
   * Unzips API folder and returns path to the folder in tmp location.
   *
   * @param {Buffer} buffer Zip file data
   * @return {Promise<string>}
   */
  async _unzip(buffer) {
    this.tmpObj = await dir();
    return new Promise((resolve, reject) => {
      const stream = new Duplex();
      stream.push(buffer);
      stream.push(null);
      const extractor = unzipper.Extract({
        path: this.tmpObj.path,
      });
      extractor.on('close', () => {
        resolve(this.tmpObj.path);
      });
      extractor.on('error', (err) => {
        reject(err);
      });
      stream.pipe(extractor);
    });
  }

  /**
   * The zip may have source files enclosed in a folder.
   * This will look for a folder in the root path and will copy sources from it.
   *
   * @param {string} destination A place where the zip sources has been extracted.
   * @return {Promise<void>}
   */
  async _removeZipMainFolder(destination) {
    let files = await fs.readdir(destination);
    files = files.filter((item) => item !== '__MACOSX');
    if (files.length > 1) {
      return;
    }
    const dirPath = path.join(destination, files[0]);
    const stats = await fs.stat(dirPath);
    if (stats.isDirectory()) {
      await fs.copy(dirPath, destination);
    }
  }

  /**
   * Removes created temporary directory.
   * @return {Promise<void>}
   */
  async _cleanTempFiles() {
    if (!this.tmpObj) {
      return;
    }
    if (this.#tmpIsFile) {
      this.tmpObj.cleanup();
      this.tmpObj = undefined;
      return;
    }
    await fs.emptyDir(this.tmpObj.path);
    this.tmpObj.cleanup();
    this.tmpObj = undefined;
  }

  /**
   * Creates a child process for the parser. It ensures stability of
   * the application when the parser is having trouble parsing the API.
   * Otherwise it would make the application unstable.
   *
   * @return {ChildProcess} A reference to the child process
   */
  _createParserProcess() {
    if (this._parserProc) {
      if (this._parserProc.connected) {
        return this._parserProc;
      }
      this._killParser();
    }
    const options = {
      execArgv: [],
    };
    this._parserProc = fork(`${__dirname}/amf-parser.js`, options);
    this._parserProc.on('exit', () => {
      this._cancelParseProcTimeout();
      this._cancelMonitorParser();
      this._parserProc = undefined;
    });
    return this._parserProc;
  }

  /**
   * Sets process timeout.
   * @param {Function} cb Function to be called when timeout is triggered.
   * @param {Number} [time=180000] Process timeout.
   */
  _setParserProcTimeout(cb, time = 180000) {
    this._parserProcCb = cb;
    this._parserProcessTimeout = setTimeout(() => {
      this._parserProcessTimeout = undefined;
      this._killParser();
      const fn = this._parserProcCb;
      this._parserProcCb = undefined;
      fn();
    }, time);
  }

  /**
   * Cancels process timeout
   */
  _cancelParseProcTimeout() {
    if (this._parserProcessTimeout) {
      clearTimeout(this._parserProcessTimeout);
      this._parserProcessTimeout = undefined;
      this._parserProcCb = undefined;
    }
  }

  /**
   * Kills created child process, if any.
   */
  _killParser() {
    this._cancelParseProcTimeout();
    this._cancelMonitorParser();
    if (this._parserProc) {
      this._parserProc.disconnect();
      this._parserProc.removeAllListeners('message');
      this._parserProc.removeAllListeners('error');
      this._parserProc.removeAllListeners('exit');
      this._parserProc.kill();
      this._parserProc = undefined;
    }
  }

  /**
   * Sets a timeout to kill child process.
   */
  _monitorParserProc() {
    this._parserMonitorTimeout = setTimeout(() => {
      this._parserMonitorTimeout = undefined;
      this._killParser();
    }, 60000);
  }

  /**
   * Cancels child process kill timeout, if any.
   */
  _cancelMonitorParser() {
    if (this._parserMonitorTimeout) {
      clearTimeout(this._parserMonitorTimeout);
    }
  }

  /**
   * Runs the parser.
   *
   * @param {string} apiLocation API file location
   * @param {ApiSearchTypeResult} type API type info object.
   * @return {Promise<string>}
   */
  _runParser(apiLocation, type) {
    this._cancelMonitorParser();
    return new Promise((resolve, reject) => {
      const callbacks = {
        onmessage: (result) => {
          if (result.validation) {
            // eslint-disable-next-line no-console
            console.log(result.validation);
            return;
          }
          this._cancelParseProcTimeout();
          this._parserProc.removeAllListeners('message');
          this._parserProc.removeAllListeners('error');
          this._parserProcCb = undefined;
          this._monitorParserProc();
          this._killParser();
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result.api);
          }
        },
        onerror: (err) => {
          this._cancelParseProcTimeout();
          this._parserProc.removeAllListeners('message');
          this._parserProc.removeAllListeners('error');
          this._parserProcCb = undefined;
          this._monitorParserProc();
          reject(new Error(err.message || 'Unknown error'));
        },
      };

      const proc = this._createParserProcess();
      this._setParserProcTimeout(() => {
        reject(new Error('API parsing timeout'));
        this._parserProc.removeAllListeners('message');
        this._parserProc.removeAllListeners('error');
        this._monitorParserProc();
      });
      proc.on('message', callbacks.onmessage);
      proc.on('error', callbacks.onerror);
      proc.send({
        source: apiLocation,
        from: type,
        validate: this.validate,
      });
    });
  }
}
