import { createHandle } from 'dojo-core/lang';
import { Handle } from 'dojo-core/interfaces';
import * as fs from 'fs';
import * as path from 'path';
import { RequestError } from 'dojo-core/request';

/**
 * Attaches an event to a Node.js EventEmitter and returns a handle for removing the listener later.
 *
 * @param {EventEmitter} emitter A Node.js EventEmitter object.
 * @param {string} event The name of the event to listen for.
 * @param {Function} listener The event listener that will be invoked when the event occurs.
 * @returns {{ remove: Function }} A remove handle.
 */
export function on(emitter: NodeJS.EventEmitter, event: string | symbol, listener: Function): Handle {
	emitter.on(event, listener);
	return createHandle(() => emitter.removeListener(event, listener));
}

/**
 * Returns true if a file or directory exists
 *
 * @param {string} filename
 * @returns {bool} true if filename exists, false otherwise
 */
export function fileExists(filename: string): boolean {
	try {
		fs.statSync(filename);
		return true;
	}
	catch (error) {
		return false;
	}
}

/**
 * Writes data to a file.
 *
 * The file's parent directories will be created if they do not already exist.
 *
 * @param {Buffer} data 
 * @param {string} filename
 * @returns {Promise.<void>} A Promise that resolves when the file has been written
 */
export function writeFile(data: any, filename: string) {
	return new Promise<void>(function (resolve, reject) {
		function mkdirp(dir: string) {
			if (!dir) {
				return;
			}

			try {
				fs.mkdirSync(dir);
			}
			catch (error) {
				// A parent directory didn't exist, create it
				if (error.code === 'ENOENT') {
					mkdirp(path.dirname(dir));
					mkdirp(dir);
				}
				else {
					if (!fs.statSync(dir).isDirectory()) {
						throw error;
					}
				}
			}
		}

		mkdirp(path.dirname(filename));
		fs.writeFile(filename, data, function (error) {
			if (error) {
				reject(error);
			}
			else {
				resolve();
			}
		});
	});
}

export function isRequestError(error: any): error is RequestError<any> {
	return error instanceof Error && Boolean((<any> error).response);
}
