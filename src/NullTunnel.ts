/**
 * @module digdug/NullTunnel
 */

import Task from 'dojo-core/async/Task';
import Tunnel from './Tunnel';
import { assign } from 'dojo-core/lang';

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
		this.isRunning = true;
		return Task.resolve();
	}
	stop() {
		this.isRunning = false;
		return Promise.resolve<number>(undefined);
	}
	sendJobState() {
		return Task.resolve();
	}
}

assign(NullTunnel.prototype, {
	auth: '',
	isDownloaded: true
});
