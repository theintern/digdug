var format = require('util').format;
var util = require('./util');

function Config(config) {
	this.name = 'default';
	if (config) {
		util.mixin(this, config);
	}
}

function SeleniumConfig(config) {
	if (typeof config === 'string') {
		this.version = config;
	}
	else if (config) {
		util.mixin(this, config);
	}
}

SeleniumConfig.prototype = {
	constructor: SeleniumConfig,
	name: 'selenium',
	version: '2.53.0',
	baseUrl: 'https://selenium-release.storage.googleapis.com',
	dontExtract: true,
	get artifact() {
		return 'selenium-server-standalone-' + this.version + '.jar';
	},
	get url() {
		var majorMinorVersion = this.version.slice(0, this.version.lastIndexOf('.'));

		return format(
			'%s/%s/%s',
			this.baseUrl,
			majorMinorVersion,
			this.artifact
		);
	},
	get executable() {
		return 'selenium-server-' + this.version + '-server.jar';
	}
};

function ChromeConfig(config) {
	if (config) {
		util.mixin(this, config);
	}
}

ChromeConfig.prototype = {
	constructor: ChromeConfig,
	name: 'chrome',
	version: '2.22',
	baseUrl: 'https://chromedriver.storage.googleapis.com',
	get artifact() {
		var platform = 'win32';

		if (process.platform === 'linux') {
			platform = 'linux' + (process.arch === 'x64' ? '64' : '32');
		}
		else if (process.platform === 'darwin') {
			platform = 'mac32';
		}

		return 'chromedriver_' + platform + '.zip';
	},
	get url() {
		return format(
			'%s/%s/%s',
			this.baseUrl,
			this.version,
			this.artifact
		);
	},
	get executable() {
		return 'chromedriver';
	},
	get seleniumProperty() {
		return 'webdriver.chrome.driver';
	}
};

function IeConfig(config) {
	if (config) {
		util.mixin(this, config);
	}
}

IeConfig.prototype = {
	constructor: IeConfig,
	name: 'ie',
	version: '2.53.0',
	baseUrl: 'https://selenium-release.storage.googleapis.com',
	get artifact() {
		var architecture = process.arch === 'x64' ? 'x64' : 'Win32';

		return format(
			'IEDriverServer_%s_%s.zip',
			architecture,
			this.version
		);
	},
	get url() {
		var majorMinorVersion = this.version.slice(0, this.version.lastIndexOf('.'));

		return format(
			'%s/%s/%s',
			this.baseUrl,
			majorMinorVersion,
			this.artifact
		);
	},
	get executable() {
		// TODO implement
	},
	get seleniumProperty() {
		return 'webdriver.ie.driver';
	}
};

function FirefoxConfig(config) {
	if (config) {
		util.mixin(this, config);
	}
}

FirefoxConfig.prototype = {
	constructor: FirefoxConfig,
	name: 'firefox',
	version: '0.8.0',
	baseUrl: 'https://github.com/mozilla/geckodriver/releases/download',
	get artifact() {
		var fileVersion = (process.platform === 'win32' ? 'v' : '') + this.version;
		var platform = (process.platform === 'linux' ? 'linux64'
			: process.platform === 'darwin' ? 'OSX' : 'win32');
		var type = (process.platform === 'win32' ? '.zip' : '.gz');

		return format(
			'geckodriver-%s-%s%s',
			fileVersion,
			platform,
			type
		);
	},
	get url() {
		return format(
			'%s/v%s/%s',
			this.baseUrl,
			this.version,
			this.artifact
		);
	},
	get executable() {
	},
	get seleniumProperty() {
		return 'webdriver.gecko.driver';
	}
};

exports.drivers = {
	chrome: ChromeConfig,
	ie: IeConfig,
	firefox: FirefoxConfig
};

exports.getDriverConfig = function (data) {
	var name = data.name || data;
	if (!name) {
		return data;
	}

	var Constructor = exports.drivers[name] || Config;
	return typeof data === 'string' ?
		new Constructor() : new Constructor(data);
};

exports.SeleniumConfig = SeleniumConfig;
