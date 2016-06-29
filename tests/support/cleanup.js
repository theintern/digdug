define([
	'intern',
	'intern/dojo/node!fs',
	'intern/dojo/node!path'
], function (intern, fs, pathUtil) {
	return function cleanup(tunnel) {
		if (intern.args.noClean) {
			return;
		}

		function deleteRecursive(dir) {
			var files = [];
			if (fs.existsSync(dir)) {
				files = fs.readdirSync(dir);
				files.forEach(function(file) {
					var path = pathUtil.join(dir, file);
					try {
						if (fs.lstatSync(path).isDirectory()) {
							deleteRecursive(path);
						}
						else {
							fs.unlinkSync(path);
						}
					}
					catch (error) {
						if (error.code !== 'ENOENT') {
							console.warn('Unable to delete ' + path, error);
						}
					}
				});
				fs.rmdirSync(dir);
			}
		}

		deleteRecursive(tunnel.directory);
	};
});
