import { ChildProcess } from 'child_process';
import { AmfService } from '../lib/AmfService.js';
import { AmfServiceProcessingOptions, ApiParseResult } from '../types';

/**
 * A class to be used in the renderer process to download and extract RAML
 * data from Exchange asset.
 */
export declare class ElectronAmfService {
  /**
   * The processing flag
   */
  #loading: boolean;

  /**
   * The id of the generated process.
   */
  #loadingId: string;

  #amfService: AmfService;

  loading: boolean;

  /**
   * A reference to the AMF service
   */
  get service(): AmfService;

  /**
   * Cleans up the working dir after work is done.
   */
  cleanup(): Promise<void>;

  /**
   * Downloads the file and processes it as a zipped API project.
   *
   * @param url API remote location.
   * @param mainFile API main file. If not set the program will try to find the best match.
   * @param md5 When set it will test data integrity with the MD5 hash
   * @param packaging Default to `zip`.
   * @returns Promise resolved to the AMF json-ld model.
   */
  processApiLink(url: string, mainFile?: string, md5?: string, packaging?: string): Promise<ApiParseResult>;

  /**
   * Processes file data.
   * If the blob is a type of `application/zip` it processes the file as a
   * zip file. Otherwise it processes it as a file.
   *
   * @param file File to process.
   * @return Promise resolved to the AMF json-ld model
   */
  processApiFile(file: File|Blob): Promise<ApiParseResult>;

  /**
   * Parses API data to AMF model.
   * @param buffer Buffer created from API file.
   * @param [opts={}] Processing options
   * @return Promise resolved to the AMF json-ld model
   */
  processBuffer(buffer: Buffer, opts?: AmfServiceProcessingOptions): Promise<ApiParseResult>;

  /**
   * Processes candidates response from the AMF service
   * @param service A reference to AmfService
   * @param candidates List of candidates
   */
  _processCandidates(service: AmfService, candidates: string[]): Promise<ApiParseResult>;

  /**
   * Tests if the buffer has ZIP file header.
   * @param buffer File buffer
   * @returns true if the buffer is compressed zip.
   */
  _bufferIsZip(buffer: Buffer): boolean;

  /**
   * Transforms file to a buffer.
   * @param blob A file to process
   */
  _fileToBuffer(blob: Blob): Promise<Buffer>;

  /**
   * Downloads and processes RAML data.
   *
   * @TODO: Handle authorization.
   *
   * @param url URL to RAML zip asset.
   * @returns Resolved when components are loaded and process started.
   */
  downloadRamlData(url: string): Promise<Buffer>;

  /**
   * Checks for Exchange file integrity, using passed md5 hash.
   * @param buffer File's buffer
   * @param md5 File's hash
   */
  _checkIntegrity(buffer: Buffer, md5: string): Buffer;

  /**
   * Resolves AMD model using AMF's resolved pipeline. This model can be used in API Console.
   * @param model AMF's unresolved model
   * @param type API type
   */
  resolveAPiConsole(model: any, type: string): Promise<string>;

  /**
   * Creates new child process for the AMF resolver.
   * @returns Child process reference.
   */
  _createResolverProcess(): ChildProcess;

  /**
   * Kills resolver child process.
   * @param proc A reference to the child process.
   */
  _killResolver(proc: ChildProcess): void;

  get selectorTemplate(): HTMLTemplateElement;

  notifyApiCandidates(candidates: string[]): Promise<string|undefined>;
}
