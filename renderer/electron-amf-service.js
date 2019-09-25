import { AmfService } from '../lib/amf-service';
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
    window.addEventListener('process-exchange-asset-data', this._assetHandler);
    window.addEventListener('api-process-file', this._fileHandler);
  }
  /**
   * Removes observers for ARC's DOM events
   *
   * @return {Promise}
   */
  unlisten() {
    window.removeEventListener('process-exchange-asset-data',
        this._assetHandler);
    window.removeEventListener('api-process-file', this._fileHandler);
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
   * Handler for the `process-exchange-asset-data` custom event from Exchange
   * asset search panel.
   *
   * @param {CustomEvent} e
   */
  async _assetHandler(e) {
    if (e.defaultPrevented) {
      return;
    }
    e.preventDefault();
    const asset = e.detail;
    let file = asset.files.find((i) => i.classifier === 'fat-raml');
    if (!file) {
      file = asset.files.find((i) => i.classifier === 'raml');
    }
    if (!file || !file.externalLink) {
      this.notifyError('RAML data not found in the asset.');
      return;
    }
    try {
      const model = await this.processApiLink(file.externalLink);
      setTimeout(() => {
        this.notifyApi(model);
      });
      return model;
    } catch (cause) {
      this.notifyError(cause.message);
    }
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
   * It downloads the file and processes it as a zipped API project.
   * @param {String} url API remote location.
   * @return {Promise<Object>} Promise resolved to the AMF json-ld model.
   */
  async processApiLink(url) {
    this.loading = true;
    try {
      const buffer = await this.downloadRamlData(url);
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
    if (this._bufferIsZip(buffer)) {
      if (!opts) {
        opts = {};
      }
      opts.zip = true;
    }
    const service = this.service;
    service.setSource(buffer, opts);

    let result;
    let exception;
    try {
      await service.prepare();
      const candidates = await service.resolve();
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
        setTimeout(() => {
          this.notifyApi(model);
        });
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
          `Unable to download the asset. Status: ${response.status}`
      );
    }
    const buff = await response.arrayBuffer();
    return Buffer.from(buff);
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
