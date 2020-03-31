import { AmfService } from '../lib/amf-service';
import { fork } from 'child_process';
import path from 'path';
import crypto from 'crypto';
/**
 * A class to be used in the renderer process to download and extract RAML
 * data from Exchange asset.
 */
export class ElectronAmfService {
  /**
   * @constructor
   */
  constructor() {
    this._assetHandler = this._assetHandler.bind(this);
    this._fileHandler = this._fileHandler.bind(this);
    this._resolveHandler = this._resolveHandler.bind(this);
  }
  /**
   * Sets `loading` flag.
   * When `true` then it dispatches `process-loading-start` custom event.
   * When `false` then it dispatches `process-loading-stop` custom event.
   * @param {Boolean} value
   */
  set loading(value) {
    if (this.__loading === value) {
      return;
    }
    this.__loading = value;
    const type = 'process-loading-' + (value ? 'start' : 'stop');
    let detail;
    if (value) {
      this.__loadingId = Date.now();
      detail = {
        message: 'Processing API data',
        indeterminate: true,
      };
    } else {
      detail = {};
    }
    detail.id = this.__loadingId;
    this.fire(type, detail);
  }
  /**
   * @return {Boolean} Loading state
   */
  get loading() {
    return this.__loading;
  }
  /**
   * @return {AmfService} A reference to AMF service
   */
  get service() {
    if (!this._amfService) {
      this._amfService = new AmfService();
    }
    return this._amfService;
  }
  /**
   * Observes for ARC's DOM events
   */
  listen() {
    window.addEventListener('api-process-link', this._assetHandler);
    window.addEventListener('api-process-file', this._fileHandler);
    window.addEventListener('api-resolve-model', this._resolveHandler);
  }
  /**
   * Removes observers for ARC's DOM events
   *
   * @return {Promise}
   */
  unlisten() {
    window.removeEventListener('api-process-link', this._assetHandler);
    window.removeEventListener('api-process-file', this._fileHandler);
    window.removeEventListener('api-resolve-model', this._resolveHandler);
    return this.cleanup();
  }
  /**
   * Cleans up the working dir after work is done.
   * @return {Promise}
   */
  async cleanup() {
    const service = this.service;
    if (service.source) {
      await service.cleanup();
    }
  }
  /**
   * Handler for the `api-process-link`. The event contains `url` of the asset
   * to download and additional, helper properties:
   * - mainFile {String} - API main file. If not set the program will
   * try to discover main API file.
   * - md5 {String} - File hash with md5. If not set the checksum is not tested.
   * - packaging {String} Compression format. Default to zip.
   *
   * @param {CustomEvent} e
   */
  async _assetHandler(e) {
    if (e.defaultPrevented) {
      return;
    }
    e.preventDefault();
    const { url, mainFile, md5, packaging } = e.detail;
    e.detail.result = this.processApiLink(url, mainFile, md5, packaging);
  }
  /**
   * Handles `api-process-file` custom event.
   * The event is cancelled and the `result` property is set on
   * the detail object with resut of calling `processApiFile()`
   * @param {CustomEvent} e
   */
  _fileHandler(e) {
    if (e.defaultPrevented) {
      return;
    }
    e.preventDefault();
    if (!e.detail.file) {
      e.detail.result = Promise.reject(new Error('File not set.'));
      return;
    }
    e.detail.result = this.processApiFile(e.detail.file);
  }
  /**
   * Handler for the `api-resolve-model` event.
   * Resolves unresolved model using the "editing" pipeline of AMF.
   * @param {CustomEvent} e
   */
  _resolveHandler(e) {
    if (e.defaultPrevented) {
      return;
    }
    e.preventDefault();
    const { model, type } = e.detail;
    if (!model) {
      e.detail.result = Promise.reject(
          new Error('The "model" property is not set.'));
      return;
    }
    if (typeof model !== 'string') {
      e.detail.result = Promise.reject(
          new Error('The "model" property is not a string.'));
      return;
    }
    if (!type) {
      e.detail.result = Promise.reject(
          new Error('The API "type" property is not set.'));
      return;
    }
    e.detail.result = this.resolveAPiConsole(model, type);
  }
  /**
   * It downloads the file and processes it as a zipped API project.
   * @param {String} url API remote location.
   * @param {?String} mainFile API main file. If not set the program will try to
   * find the best match.
   * @param {?String} md5 When set it will test data integrity with the hash
   * @param {?String} packaging Default to `zip`.
   * @return {Promise<String>} Promise resolved to the AMF json-ld model.
   */
  async processApiLink(url, mainFile, md5, packaging) {
    this.loading = true;
    const bufferOpts = {};
    if (packaging && packaging === 'zip') {
      bufferOpts.zip = true;
    }
    if (mainFile) {
      bufferOpts.mainFile = mainFile;
    }
    try {
      const buffer = await this.downloadRamlData(url);
      this._checkIntegrity(buffer, md5);
      const result = await this.processBuffer(buffer);
      this.loading = false;
      return result;
    } catch (cause) {
      this.loading = false;
      throw cause;
    }
  }
  /**
   * Procesases file data.
   * If the blob is a type of `application/zip` it processes the file as a
   * zip file. Otherwise it processes it as a file.
   *
   * @param {File|Blob} file File to process.
   * @return {Promise<Object>} Promise resolved to the AMF json-ld model
   */
  async processApiFile(file) {
    // const t = file.type;
    // const zip = (t && t.indexOf('/zip') !== -1) ? true : false;
    this.loading = true;
    try {
      const buffer = await this._fileToBuffer(file);
      const result = await this.processBuffer(buffer);
      this.loading = false;
      return result;
    } catch (cause) {
      this.loading = false;
      throw cause;
    }
  }
  /**
   * Parses API data to AMF model.
   * @param {Buffer} buffer Buffer created from API file.
   * @param {Object} opts Processing options:
   * - zip {Boolean} If true the buffer represents zipped file.
   * @return {Promise<Object>} Promise resolved to the AMF json-ld model
   */
  async processBuffer(buffer, opts) {
    if (!this.loading) {
      this.loading = true;
    }
    if (!opts) {
      opts = {};
    }
    if (!opts.zip && this._bufferIsZip(buffer)) {
      opts.zip = true;
    }
    const service = this.service;
    service.setSource(buffer, opts);

    let result;
    let exception;
    try {
      await service.prepare();
      const candidates = await service.resolve(opts.mainFile);
      if (candidates) {
        result = await this._processCandidates(service, candidates);
      } else {
        result = await service.parse();
      }
    } catch (cause) {
      exception = cause;
    }
    this.loading = false;
    if (exception) {
      throw exception;
    }
    return result;
  }
  /**
   * Processes candidates response from the AMF service
   * @param {AmfService} service A reference to AmfService
   * @param {Array} candidates List of candidates
   * @return {Promise}
   */
  async _processCandidates(service, candidates) {
    try {
      const file = await this.notifyApiCandidates(candidates);
      if (!file) {
        await service.cancel();
      } else {
        const model = await service.parse(file);
        // setTimeout(() => {
        //   this.notifyApi(model);
        // });
        return model;
      }
    } catch (e) {
      await service.cancel();
      throw e;
    }
  }
  /**
   * Tests if the buffer has ZIP file header.
   * @param {Buffer} buffer File buffer
   * @return {Boolean} true if the buffer is compressed zip.
   */
  _bufferIsZip(buffer) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  /**
   * Transforms file to a buffer.
   * @param {Blob} blob A file to process
   * @return {Promise}
   */
  async _fileToBuffer(blob) {
    if (blob instanceof Buffer) {
      return blob;
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('loadend', (e) => {
        resolve(Buffer.from(e.target.result));
      });
      reader.addEventListener('error', () => {
        reject(new Error('Unable to translate the file to buffer'));
      });
      reader.readAsArrayBuffer(blob);
    });
  }
  /**
   * Downloads and processes RAML data.
   *
   * @TODO: Handle authorization.
   *
   * @param {String} url URL to RAML zip asset.
   * @return {Promise} Resolved when components are loaded and process
   * started.
   */
  async downloadRamlData(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
          `Unable to download the asset. Status: ${response.status}`,
      );
    }
    const buff = await response.arrayBuffer();
    return Buffer.from(buff);
  }
  /**
   * Checks for Exchange file integrity, using passed md5 hash.
   * @param {Buffer} buffer File's buffer
   * @param {String} md5 File's hash
   * @return {Buffer}
   * @throws {Error} When computed md5 sum is not valid.
   */
  _checkIntegrity(buffer, md5) {
    if (!md5) {
      return buffer;
    }
    const hash = crypto.createHash('md5').update(buffer, 'utf8').digest('hex');
    if (hash === md5) {
      return buffer;
    }
    throw new Error('API file integrity test failed. Checksum missmatch.');
  }
  /**
   * Resolves AMD model using AMF's resolved pipeline. This model can be used
   * in API Console.
   * @param {Object} model AMF's unresolved model
   * @param {String} type API type
   * @return {Promise}
   */
  async resolveAPiConsole(model, type) {
    return new Promise((resolve, reject) => {
      const proc = this._createResolverProcess();
      const callbacks = {
        onmessage: (result) => {
          this._killResolver(proc);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result.api);
          }
        },
        onerror: (err) => {
          this._killResolver(proc);
          reject(new Error(err.message || 'Unknown error'));
        },
      };
      proc.on('message', callbacks.onmessage);
      proc.on('error', callbacks.onerror);
      proc.send({
        model,
        type,
      });
    });
  }
  /**
   * Creates new child process for the AMF resolver.
   * @return {Object} Child process reference.
   */
  _createResolverProcess() {
    const options = {
      execArgv: [],
    };
    return fork(path.join(__dirname, '..', 'lib', 'amf-resolver.js'), options);
  }
  /**
   * Kills resolver child process.
   * @param {Object} proc A reference to the child rpocess.
   */
  _killResolver(proc) {
    if (proc.connected) {
      proc.disconnect();
    }
    proc.removeAllListeners('message');
    proc.removeAllListeners('error');
    proc.kill();
  }
  /**
   * Dispatches a custom event
   * @param {String} type Event type
   * @param {?Object} detail The detail object
   * @return {CustomEvent} Created event.
   */
  fire(type, detail) {
    const e = new CustomEvent(type, {
      bubbles: true,
      cancelable: true,
      detail,
    });
    document.body.dispatchEvent(e);
    return e;
  }
  /**
   * Dispatches `process-error` custom event.
   * This only happens when `process-exchange-asset-data` event was handled
   *
   * @param {String} message Message to render.
   */
  notifyError(message) {
    console.error(message);
    this.fire('process-error', {
      message,
      source: 'amf-service',
    });
  }
  /**
   * Dispatches `api-data-ready` custom event.
   * This only happens when `process-exchange-asset-data` event was handled
   *
   * @param {Array|Object} api API's AMF model
   */
  notifyApi(api) {
    this.fire('api-data-ready', {
      api,
    });
  }
  /**
   * Dispatches `api-select-entrypoint` custom event.
   * The app should handle this event in order to proceed with the parsing flow.
   * @param {Array<String>} candidates
   * @return {Promise<String|undefined>}
   */
  async notifyApiCandidates(candidates) {
    const e = this.fire('api-select-entrypoint', {
      candidates,
    });
    if (e.defaultPrevented) {
      return await e.detail.result;
    }
    throw new Error('No UI for selecting API main file :(');
  }
}
