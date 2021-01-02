import { fork } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { ProcessEvents } from '@advanced-rest-client/arc-events';
import { AmfService } from '../lib/AmfService.js';

/** @typedef {import('../types').AmfServiceProcessingOptions} AmfServiceProcessingOptions */
/** @typedef {import('../types').ApiParseResult} ApiParseResult */
/** @typedef {import('child_process').ChildProcess} ChildProcess */

/**
 * A class to be used in the renderer process to download and extract RAML
 * data from Exchange asset.
 */
export class ElectronAmfService {
  /**
   * The processing flag
   */
  #loading = false;

  /**
   * The id of the generated process.
   * @type {string}
   */
  #loadingId;

  /**
   * @type {AmfService}
   */
  #amfService;

  /**
   * Sets `loading` flag.
   * When `true` then it dispatches `process-loading-start` custom event.
   * When `false` then it dispatches `process-loading-stop` custom event.
   * @param {boolean} value
   */
  set loading(value) {
    if (this.#loading === value) {
      return;
    }
    this.#loading = value;
    if (value) {
      this.#loadingId = String(Date.now());
      ProcessEvents.loadingstart(document.body, this.#loadingId, 'Processing API data');
    } else {
      ProcessEvents.loadingstop(document.body, this.#loadingId);
    }
  }

  /**
   * @return {boolean} Loading state
   */
  get loading() {
    return this.#loading;
  }

  /**
   * @return {AmfService} A reference to AMF service
   */
  get service() {
    if (!this.#amfService) {
      this.#amfService = new AmfService();
    }
    return this.#amfService;
  }

  /**
   * Cleans up the working dir after work is done.
   * @return {Promise<void>}
   */
  async cleanup() {
    const service = this.service;
    if (service.source) {
      await service.cleanup();
    }
  }

  /**
   * Downloads the file and processes it as a zipped API project.
   *
   * @param {string} url API remote location.
   * @param {string=} mainFile API main file. If not set the program will try to find the best match.
   * @param {string=} md5 When set it will test data integrity with the MD5 hash
   * @param {string=} packaging Default to `zip`.
   * @return {Promise<ApiParseResult>} Promise resolved to the AMF json-ld model.
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
   * Processes file data.
   * If the blob is a type of `application/zip` it processes the file as a
   * zip file. Otherwise it processes it as a file.
   *
   * @param {File|Blob} file File to process.
   * @return {Promise<ApiParseResult>} Promise resolved to the AMF json-ld model
   */
  async processApiFile(file) {
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
   * @param {AmfServiceProcessingOptions=} [opts={}] Processing options
   * @return {Promise<ApiParseResult>} Promise resolved to the AMF json-ld model
   */
  async processBuffer(buffer, opts={}) {
    if (!this.loading) {
      this.loading = true;
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
   * @param {string[]} candidates List of candidates
   * @return {Promise<ApiParseResult>}
   */
  async _processCandidates(service, candidates) {
    try {
      const file = await this.notifyApiCandidates(candidates);
      if (!file) {
        await service.cancel();
      } else {
        return service.parse(file);
      }
    } catch (e) {
      await service.cancel();
      throw e;
    }
  }

  /**
   * Tests if the buffer has ZIP file header.
   * @param {Buffer} buffer File buffer
   * @return {boolean} true if the buffer is compressed zip.
   */
  _bufferIsZip(buffer) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  /**
   * Transforms file to a buffer.
   * @param {Blob} blob A file to process
   * @return {Promise<Buffer>}
   */
  async _fileToBuffer(blob) {
    if (blob instanceof Buffer) {
      return blob;
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('loadend', (e) => {
        // @ts-ignore
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
   * @return {Promise<Buffer>} Resolved when components are loaded and process
   * started.
   */
  async downloadRamlData(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to download the asset. Status: ${response.status}`);
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
    // @ts-ignore
    const hash = crypto.createHash('md5').update(buffer, 'utf8').digest('hex');
    if (hash === md5) {
      return buffer;
    }
    throw new Error('API file integrity test failed. Checksum mismatch.');
  }

  /**
   * Resolves AMD model using AMF's resolved pipeline. This model can be used in API Console.
   * @param {any} model AMF's unresolved model
   * @param {string} type API type
   * @return {Promise<string>}
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
   * @return {ChildProcess} Child process reference.
   */
  _createResolverProcess() {
    const options = {
      execArgv: [],
    };
    return fork(path.join(__dirname, '..', 'lib', 'amf-resolver.js'), options);
  }

  /**
   * Kills resolver child process.
   * @param {ChildProcess} proc A reference to the child process.
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
   * @return {HTMLTemplateElement}
   */
  get selectorTemplate() {
    const t = document.createElement('template');
    t.innerHTML = `
    <dialog class="apiEntryPointDialog">
      <form method="dialog">
        <div class="dialog-content">
          <label for="entryPointSelector" class="dialog-title">Select API main file</label>
          <select name="files" id="entryPointSelector" class="api-entry-point-selector"></select>
        </div>
        <div class="dialog-actions">
          <button value="cancel">Cancel</button>
          <button id="confirmBtn" value="default">Confirm</button>
        </div>
      </form>
    </dialog>
    `;
    return t;
  }

  /**
   * @param {string[]} candidates
   * @return {Promise<string|undefined>}
   */
  async notifyApiCandidates(candidates) {
    const { selectorTemplate } = this;
    const dialog = /** @type HTMLDialogElement */ (selectorTemplate.content.firstElementChild.cloneNode(true));
    const select = dialog.querySelector('select');
    const f = document.createDocumentFragment();
    f.appendChild(document.createElement('option'));
    candidates.forEach((file) => {
      const o = document.createElement('option');
      o.innerText = file;
      f.appendChild(o);
    });
    select.innerHTML = '';
    select.appendChild(f);
    document.body.appendChild(dialog);
    dialog.showModal();
    /** @type HTMLButtonElement */ (dialog.querySelector('#confirmBtn')).value = 'default';
    select.addEventListener('change', (e) => {
      /** @type HTMLButtonElement */ (dialog.querySelector('#confirmBtn')).value = /** @type HTMLSelectElement */ (e.target).value;
    });
    return new Promise((resolve) => {
      dialog.addEventListener('close', (e) => {
        const node = /** @type HTMLDialogElement */ (e.target);
        node.parentNode.removeChild(node);
        const { returnValue } = node;
        if (['default', 'cancel'].includes(returnValue)) {
          resolve(undefined);
        } else {
          resolve(returnValue);
        }
      });
    });
  }
}
