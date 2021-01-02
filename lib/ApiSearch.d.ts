import { ApiSearchCandidate, ApiSearchTypeResult } from '../types';

/**
 * Searches for API main file in given location
 */
export class ApiSearch {
  _workingDir: string;
  /**
   * @param dir API directory location
   */
  constructor(dir: string);

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
   */
  findApiFile(): Promise<Array<String>|String|undefined>;

  /**
   * Decides which file to use as API main file.
   * @param files A file or list of files.
   */
  _decideMainFile(files: string[]): Promise<string|string[]>;

  /**
   * Reads all files and looks for 'RAML 0.8' or 'RAML 1.0' header which
   * is a WebApi.
   * @param files List of candidates
   * @param results List od results
   */
  _findWebApiFile(files: ApiSearchCandidate[], results?: string[]): Promise<string|string[]|undefined>;

  /**
   * Reads API type from the API main file.
   * @param file File location
   */
  _readApiType(file: string): Promise<ApiSearchTypeResult>
}
