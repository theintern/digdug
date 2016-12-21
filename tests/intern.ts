export const proxyPort = 9000;

export const proxyUrl = 'http://localhost:9000';

export const maxConcurrency = 3;

export const loaderOptions = {
	packages: [
		{ name: 'src', location: '_build/src' },
		{ name: 'tests', location: './_build/tests' }
	],
	map: {
		'tests': {
			// map the absolute module `src` so that it uses
			// the srcLoader to get a relative commonjs library
			'src': 'tests/srcLoader!../src',
			// ensure the `dojo` being used in the tests is the
			// same `dojo` being used by the commonjs library
			// with the exception of `dojo/node`
			'dojo': 'dojo/node!dojo',
			'dojo/node': 'dojo/node',

			'fs': 'dojo/node!fs',
			'path': 'dojo/node!path',
			'util': 'dojo/node!util',
			'url': 'dojo/node!url',
			'https': 'dojo/node!https',
			'shelljs': 'dojo/node!shelljs'
		},
		'tests/srcLoader': {
			'src': 'src'
		}
	}
};

export const loaders = {
	'host-node': 'dojo-loader'
};

export const reporters = [ 'Console' ];

export const suites = [
	'tests/unit/all',
	'tests/integration/all'
];

export const excludeInstrumentation = /^(?:_build\/tests|node_modules)\//;
