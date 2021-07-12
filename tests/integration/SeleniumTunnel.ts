import { deepMixin, request } from '@theintern/common';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { ObjectSuiteDescriptor, Tests } from 'intern/lib/interfaces/object';

import SeleniumTunnel, { DriverFile } from '../../src/SeleniumTunnel';
import { addStartStopTest } from '../support/integration';
import { cleanup, deleteTunnelFiles, getDigdugArgs } from '../support/util';
import webdriversJson from '../../src/webdrivers.json';

const origWebdriversJson = JSON.parse(JSON.stringify(webdriversJson));

function createDownloadTest(config: any) {
  return () => {
    tunnel = new SeleniumTunnel();
    Object.keys(config).forEach((key) => {
      Object.defineProperty(tunnel, key, { value: config[key] });
    });

    mkdirSync(tunnel.directory);

    const expected = tunnel['_getDriverConfigs']()
      .map((config: DriverFile) => {
        return config.executable;
      })
      .concat(tunnel.artifact)
      .filter((executable: string) => {
        // Remove any skipped artifacts
        return executable !== '.';
      });

    // Check that the progress callback is called
    let progressed = false;

    tunnel.on('downloadprogress', () => {
      progressed = true;
    });

    return tunnel.download().then(function () {
      for (const file of expected) {
        assert.isTrue(
          existsSync(join(tunnel.directory, file)),
          `expected ${file} to exist`
        );
      }
      assert.isTrue(progressed, 'expected to have seen progress');
    });
  };
}

let tunnel: SeleniumTunnel;

let tests: Tests = {
  download: (function () {
    const tests: any = {
      'selenium standalone': createDownloadTest({ drivers: [] }),
    };

    [
      { name: 'chrome', platform: 'win32' },
      { name: 'chrome', platform: 'linux', arch: 'x64' },
      { name: 'chrome', platform: 'darwin', version: '2.35' },
      { name: 'chrome', platform: 'darwin', version: '2.36' },
      { name: 'ie', arch: 'x64' },
      { name: 'ie', arch: 'x86' },
      { name: 'internet explorer' },
      { name: 'edge' },
      { name: 'MicrosoftEdge' },
      { name: 'MicrosoftEdgeChromium', platform: 'win32', arch: 'x64' },
      { name: 'MicrosoftEdgeChromium', platform: 'win32', arch: 'x86' },
      { name: 'MicrosoftEdgeChromium', platform: 'darwin' },
      { name: 'firefox', platform: 'linux' },
      { name: 'firefox', platform: 'darwin' },
      { name: 'firefox', platform: 'win32' },
    ].forEach(function (config: any) {
      let testName = config.name;
      if (config.platform) {
        testName += '-' + config.platform;
      }
      if (config.arch) {
        testName += '-' + config.arch;
      }
      if (config.version) {
        testName += '-' + config.version;
      }
      tests[testName] = createDownloadTest({
        // We don't want to download selenium every time so we're going
        // to change the Selenium configuration so isDownloaded() should
        // always report true for Selenium
        artifact: '.',
        drivers: [config],
      });
    });

    return tests;
  })(),

  isDownloaded() {
    const args = getDigdugArgs();
    if (args.noClean) {
      return this.skip('Cleanup is disabled');
    }

    tunnel = new SeleniumTunnel();
    deleteTunnelFiles(tunnel);

    assert.isFalse(tunnel.isDownloaded);
  },

  'version check': function () {
    const version = '2.25';
    const { arch } = process;
    tunnel = new SeleniumTunnel({
      drivers: [{ name: 'chrome', version }],
    });
    return tunnel.download().then(() => {
      const driver = join(tunnel.directory, version, arch, 'chromedriver');
      const result = execSync(`"${driver}" --version`).toString('utf-8');
      assert.match(
        result,
        new RegExp(`ChromeDriver ${version}\.`),
        'unexpected driver version'
      );
    });
  },

  'webdrivers.json download': {
    afterEach() {
      // reset webdriversJson
      deepMixin(webdriversJson, origWebdriversJson);
    },

    tests: {
      async 'bad url'() {
        tunnel = new SeleniumTunnel({
          drivers: [{ name: 'chrome' }, { name: 'firefox' }],
        });

        webdriversJson.drivers.chrome.latest = '2.46';

        const resp = await request(tunnel.webDriverDataUrl!);
        const data = await resp.json<typeof webdriversJson>();

        tunnel.webDriverDataUrl = '/foo';
        await tunnel.download();

        const chromedriverVersion = webdriversJson.drivers.chrome.latest;
        const chromdriver = join(
          tunnel.directory,
          chromedriverVersion,
          process.arch,
          'chromedriver'
        );
        const cdResult = execSync(`"${chromdriver}" --version`).toString(
          'utf-8'
        );
        assert.match(
          cdResult,
          new RegExp(`ChromeDriver ${chromedriverVersion}.`),
          'unexpected driver version'
        );

        const geckodriverVersion = data.drivers.firefox.latest;
        const geckodriver = join(
          tunnel.directory,
          geckodriverVersion,
          process.arch,
          'geckodriver'
        );
        const result = execSync(`"${geckodriver}" --version`).toString('utf-8');
        assert.match(
          result,
          new RegExp(geckodriverVersion),
          'unexpected driver version'
        );

        const dataFile = join(tunnel.directory, 'webdrivers.json');
        assert.isFalse(
          existsSync(dataFile),
          `did not expect ${dataFile} to exist`
        );
      },

      async 'good url'() {
        tunnel = new SeleniumTunnel({
          drivers: [{ name: 'chrome' }, { name: 'firefox' }],
        });

        const resp = await request(tunnel.webDriverDataUrl!);
        const data = await resp.json<typeof webdriversJson>();

        await tunnel.download();

        const chromedriverVersion = webdriversJson.drivers.chrome.latest;
        const chromdriver = join(
          tunnel.directory,
          chromedriverVersion,
          process.arch,
          'chromedriver'
        );
        const cdResult = execSync(`"${chromdriver}" --version`).toString(
          'utf-8'
        );
        assert.match(
          cdResult,
          new RegExp(`ChromeDriver ${chromedriverVersion}.`),
          'unexpected driver version'
        );

        const geckodriverVersion = data.drivers.firefox.latest;
        const geckodriver = join(
          tunnel.directory,
          geckodriverVersion,
          process.arch,
          'geckodriver'
        );
        const result = execSync(`"${geckodriver}" --version`).toString('utf-8');
        assert.match(
          result,
          new RegExp(geckodriverVersion),
          'unexpected driver version'
        );

        const dataFile = join(tunnel.directory, 'webdrivers.json');
        assert.isTrue(existsSync(dataFile), `expected ${dataFile} to exist`);
      },
    },
  },
};

tests = addStartStopTest(tests, SeleniumTunnel, {
  needsAuthData: false,
});

const suite: ObjectSuiteDescriptor = {
  beforeEach() {
    this.timeout = 10 * 60 * 1000; // ten minutes
  },

  afterEach() {
    return cleanup(tunnel);
  },

  tests,
};

registerSuite('integration/SeleniumTunnel', suite);
