const {AmfService} = require('../lib/amf-service');
/**
 * A class to be used in the renderer process to download and extract RAML
 * data from Exchange asset.
 */
class ElectronAmfService {
  constructor() {
    this._assetHandler = this._assetHandler.bind(this);
    this._fileHandler = this._fileHandler.bind(this);
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
    window.removeEventListener('process-exchange-asset-data', this._assetHandler);
    window.removeEventListener('api-process-file', this._fileHandler);
    return this.cleanup();
  }

  cleanup() {
    if (this.amfService) {
      return this.amfService.cleanup()
      .then(() => {
        this.amfService = undefined;
      });
    }
    return Promise.resolve();
  }
  /**
   * Handler for the `process-exchange-asset-data` custom event from Exchange
   * asset search panel.
   *
   * @param {CustomEvent} e
   */
  _assetHandler(e) {
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
    this.processApiLink(file.externalLink)
    .then((model) => {
      setTimeout(() => {
        this.notifyApi(model);
      });
      return model;
    })
    .catch((cause) => {
      this.notifyError(cause.message);
    });
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
  processApiLink(url) {
    return this.downloadRamlData(url)
    .then((buffer) => this.processBuffer(buffer));
  }
  /**
   * Procesases file data.
   * If the blob is a type of `application/zip` it processes the file as a
   * zip file. Otherwise it processes it as a file.
   *
   * @param {File|Blob} file File to process.
   * @return {Promise<Object>} Promise resolved to the AMF json-ld model
   */
  processApiFile(file) {
    // const t = file.type;
    // const zip = (t && t.indexOf('/zip') !== -1) ? true : false;
    return this._fileToBuffer(file)
    .then((buffer) => this.processBuffer(buffer));
  }
  /**
   * Parses API data to AMF model.
   * @param {Buffer} buffer Buffer created from API file.
   * @param {Object} opts Processing options:
   * - zip {Boolean} If true the buffer represents zipped file.
   * @return {Promise<Object>} Promise resolved to the AMF json-ld model
   */
  processBuffer(buffer, opts) {
    if (this._bufferIsZip(buffer)) {
      if (!opts) {
        opts = {};
      }
      opts.zip = opts;
    }
    if (!this.amfService) {
      this.amfService = new AmfService(buffer, opts);
    } else {
      this.amfService.setSource(buffer, opts);
    }
    return this.amfService.prepare()
    .then(() => this.amfService.resolve())
    .then((candidates) => {
      if (candidates) {
        return this.notifyApiCandidates(candidates)
        .catch((cause) => {
          return this.amfService.cancel()
          .then(() => {
            throw cause;
          });
        })
        .then((file) => {
          if (file) {
            return this.amfService.parse(file);
          }
          return this.amfService.cancel();
        })
        .then((model) => {
          if (model) {
            setTimeout(() => {
              this.notifyApi(model);
            });
            return model;
          }
        });
      } else {
        return this.amfService.parse();
      }
    });
  }
  /**
   * Tests if the buffer has ZIP file header.
   * @param {Buffer} buffer File buffer
   * @return {Boolean} true if the buffer is compressed zip.
   */
  _bufferIsZip(buffer) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  _fileToBuffer(blob) {
    if (blob instanceof Buffer) {
      return Promise.resolve(blob);
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
  downloadRamlData(url) {
    return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to download the asset. Status: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((aBuffer) => Buffer.from(aBuffer));
  }

  fire(type, detail) {
    const e = new CustomEvent(type, {
      bubbles: true,
      cancelable: true,
      detail
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
      source: 'amf-service'
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
      api
    });
  }
  /**
   * Dispatches `api-select-entrypoint` custom event.
   * The app should handle this event in order to proceed with the parsing flow.
   * @param {Array<String>} candidates
   * @return {Promise<String|undefined>}
   */
  notifyApiCandidates(candidates) {
    const e = this.fire('api-select-entrypoint', {
      candidates
    });
    if (e.defaultPrevented) {
      return e.detail.result;
    }
    return Promise.reject(new Error('No UI for selecting API main file :('));
  }
}
module.exports.ElectronAmfService = ElectronAmfService;
