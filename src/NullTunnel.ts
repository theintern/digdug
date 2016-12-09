/**
 * @module digdug/NullTunnel
 */

import Task from 'dojo-core/async/Task';
import Tunnel from './Tunnel';
import { assign } from './util';

/**
 * A no-op tunnel.
 *
 * @constructor module:digdug/NullTunnel
 * @extends module:digdug/Tunnel
 */
export default class NullTunnel extends Tunnel {
	download() {
		return Task.resolve();
	}
	start() {
		this._state = 'running';
		return Task.resolve();
	}
	stop() {
		this._state = 'stopped';
		return Promise.resolve<number>(0);
	}
	sendJobState() {
		return Task.resolve();
	}
}

assign(NullTunnel.prototype, {
	auth: '',
	isDownloaded: true
});
