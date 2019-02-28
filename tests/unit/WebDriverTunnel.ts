import WebDriverTunnel, { WebDriver } from '../../src/WebDriverTunnel';
import * as util from '../../src/lib/util';
import {
  CHROME,
  EDGE,
  FIREFOX,
  INTERNET_EXPLORER,
  SAFARI,
  WebDriverConfig
} from '../../src/lib/webDriverConfig';
import { createSandbox, SinonSandbox, SinonStub } from 'sinon';
import * as child_process from 'child_process';
import { ExecSyncOptions } from 'child_process';
import * as tunnelChildProcesses from '../../src/lib/tunnelChildProcesses';
import { CancellablePromise, Task } from '@theintern/common';
import { ChildExecutor } from '../../src/Tunnel';
import { EventEmitter } from 'events';
import { join } from 'intern/lib/common/path';
import { fail } from 'assert';

type DownloadFileStub = SinonStub<any[], Promise<void>>;

class MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;

  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

let tunnel: WebDriverTunnel;
let sandbox: SinonSandbox;
let execSyncStub: SinonStub<[string, (ExecSyncOptions | undefined)?], Buffer>;
let platformStub: SinonStub<any[], any>;
let downloadFileStub: DownloadFileStub;
let webdriverProxyStartStub: SinonStub<[], Promise<void>>;
let webdriverProxyStopStub: SinonStub<[], Promise<void>>;
let childProcess: MockChildProcess;

const BROWSER_NAMES = [CHROME, FIREFOX, SAFARI, INTERNET_EXPLORER, EDGE];

registerSuite('unit/WebDriverTunnel', {
  beforeEach() {
    sandbox = createSandbox();

    // Set the platform to a know value.  This will make the tests independent of the platform
    // on which the tests are running.
    platformStub = sandbox.stub(process, 'platform').value('somePlatform');

    // Stub out execSync.
    execSyncStub = sandbox.stub(child_process, 'execSync');
    // Don't spawn any child processes.
    sandbox.stub(child_process, 'spawn');
  },

  afterEach() {
    sandbox.restore();
  },

  tests: {
    config: {
      'default config'() {
        const tunnel = new WebDriverTunnel({});
        assert.strictEqual(tunnel.driverDirectory, 'webdriver_tunnel');
        assert.strictEqual(tunnel.maxConnectAttempts, 3);
        assert.strictEqual(tunnel.startupWait, 1000);

        const webDriverConfigs = tunnel.webDriverConfigs;
        assert.strictEqual(5, Object.keys(webDriverConfigs).length);
        BROWSER_NAMES.forEach(browserName =>
          assert.exists(webDriverConfigs[browserName])
        );
      },

      'override default config'() {
        const tunnel = new WebDriverTunnel({
          driverDirectory: 'some/directory',
          maxConnectAttempts: 10,
          startupWait: 100
        });
        assert.strictEqual(tunnel.driverDirectory, 'some/directory');
        assert.strictEqual(tunnel.maxConnectAttempts, 10);
        assert.strictEqual(tunnel.startupWait, 100);
      },

      port() {
        const tunnel = new WebDriverTunnel({
          port: '8675'
        });
        assert.strictEqual(tunnel.port, '8675');
        assert.strictEqual(tunnel.lastUsedPort, 8675);
      },

      'webdriver noDownload configs'() {
        // Test the "noDownload" properties of the web driver configs when the platform
        // is not win32.
        const tunnel = new WebDriverTunnel({});
        const webDriverConfigs = tunnel.webDriverConfigs;
        assert.strictEqual(Object.keys(webDriverConfigs).length, 5);
        assert.isFalse(webDriverConfigs[CHROME].noDownload);
        assert.isFalse(webDriverConfigs[FIREFOX].noDownload);
        assert.isTrue(webDriverConfigs[SAFARI].noDownload);
        assert.isTrue(webDriverConfigs[INTERNET_EXPLORER].noDownload);
        assert.isTrue(webDriverConfigs[EDGE].noDownload);
      },

      'webdriver noDownload configs with Windows'() {
        // Test the "noDownload" properties of the web driver configs when the platform
        // is win32 and the windows version is 17134.
        platformStub.value('win32');
        execSyncStub.returns(Buffer.from('1.1.17134'));
        const tunnel = new WebDriverTunnel({});
        const webDriverConfigs = tunnel.webDriverConfigs;
        assert.strictEqual(Object.keys(webDriverConfigs).length, 5);
        assert.isFalse(webDriverConfigs[CHROME].noDownload);
        assert.isFalse(webDriverConfigs[FIREFOX].noDownload);
        assert.isTrue(webDriverConfigs[SAFARI].noDownload);
        assert.isFalse(webDriverConfigs[INTERNET_EXPLORER].noDownload);
        assert.isFalse(webDriverConfigs[EDGE].noDownload);
      },

      'webdriver noDownload configs with Windows Edge > 17134'() {
        // Test the "noDownload" properties of the web driver configs when the platform
        // is win32 and the windows version is greater than 17134.
        platformStub.value('win32');
        execSyncStub.returns(Buffer.from('1.1.17135'));
        const tunnel = new WebDriverTunnel({});
        const webDriverConfigs = tunnel.webDriverConfigs;
        assert.strictEqual(Object.keys(webDriverConfigs).length, 5);
        assert.isFalse(webDriverConfigs[CHROME].noDownload);
        assert.isFalse(webDriverConfigs[FIREFOX].noDownload);
        assert.isTrue(webDriverConfigs[SAFARI].noDownload);
        assert.isFalse(webDriverConfigs[INTERNET_EXPLORER].noDownload);
        assert.isTrue(webDriverConfigs[EDGE].noDownload);
      },

      'driver options'() {
        const tunnel = new WebDriverTunnel({
          drivers: [
            { name: CHROME, version: 'some chrome version' },
            { name: FIREFOX, version: 'some firefox version' }
          ]
        });
        const webDriverConfigs = tunnel.webDriverConfigs;

        assert.strictEqual(
          (webDriverConfigs[CHROME] as any).config.version,
          'some chrome version'
        );
        assert.strictEqual(
          (webDriverConfigs[FIREFOX] as any).config.version,
          'some firefox version'
        );
      },

      'sendJobState does nothing'() {
        const tunnel = new WebDriverTunnel({});
        const promise = tunnel.sendJobState();
        return promise.then((arg: any) => {
          assert.isUndefined(arg);
        });
      }
    },

    isDownloaded: {
      beforeEach() {
        tunnel = new WebDriverTunnel({});
      },

      tests: {
        'isDownloaded with files not existing'() {
          // Test the tunnel "isDownloaded" property when fileExists always returns false.
          const tunnel = new WebDriverTunnel({});
          const fileExistsStub = sandbox
            .stub(util, 'fileExists')
            .returns(false);
          assert.isFalse(tunnel.isDownloaded);

          // The tunnel should stop checking when the first check returns false.
          assert.strictEqual(1, fileExistsStub.callCount);
        },

        'isDownloaded with files existing no Windows'() {
          // Test the tunnel "isDownloaded" property when fileExists always returns true and
          // the platform is not win32.
          const tunnel = new WebDriverTunnel({
            platform: 'madeUpPlatform',
            basePath: __dirname,
            driverDirectory: 'test_directory'
          });
          const fileExistsStub = sandbox.stub(util, 'fileExists').returns(true);
          assert.isTrue(tunnel.isDownloaded);

          assert.strictEqual(2, fileExistsStub.callCount);

          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[CHROME]
          );
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[FIREFOX]
          );
        },

        'isDownloaded with files existing with Windows'() {
          // Test the tunnel "isDownloaded" property when fileExists always returns true and
          // the platform is win32 and the version number is small.
          platformStub.value('win32');
          execSyncStub.returns(Buffer.from('1.1.1'));
          const tunnel = new WebDriverTunnel({
            platform: 'win32',
            basePath: __dirname,
            driverDirectory: 'test_directory'
          });
          const fileExistsStub = sandbox.stub(util, 'fileExists').returns(true);
          assert.isTrue(tunnel.isDownloaded);

          assert.strictEqual(4, fileExistsStub.callCount);
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[CHROME]
          );
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[FIREFOX]
          );
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[INTERNET_EXPLORER]
          );
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[EDGE]
          );
        },

        'isDownloaded with files existing with Windows but no version'() {
          // Test the tunnel "isDownloaded" property when fileExists always returns true and
          // the platform is win32 but the version check returns undefined.
          platformStub.value('win32');
          execSyncStub.returns(Buffer.from([]));
          const tunnel = new WebDriverTunnel({
            platform: 'win32',
            basePath: __dirname,
            driverDirectory: 'test_directory'
          });
          const fileExistsStub = sandbox.stub(util, 'fileExists').returns(true);
          assert.isTrue(tunnel.isDownloaded);

          assert.strictEqual(3, fileExistsStub.callCount);
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[CHROME]
          );
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[FIREFOX]
          );
          testFileExistsStubCalledWith(
            fileExistsStub,
            tunnel.webDriverConfigs[INTERNET_EXPLORER]
          );
        }
      }
    },

    downloading: {
      beforeEach() {
        tunnel = new WebDriverTunnel({});
        // stub out the (protected) download method so nothing is actually downloaded.
        downloadFileStub = sandbox.stub(
          tunnel as any,
          '_downloadFile'
        ) as DownloadFileStub;
        downloadFileStub.returns(Promise.resolve());
      },

      tests: {
        'download with isWebDriverDownloaded true and no force'() {
          // stub out isWebDriverDownloaded to always return true.
          const isDownloadedStub = (sandbox.stub(
            tunnel as any,
            'isWebDriverDownloaded'
          ) as SinonStub<WebDriverConfig[], boolean>).returns(true);

          return tunnel.download(false).then(() => {
            assert.isFalse(
              downloadFileStub.called,
              '_downloadFile was called when it should not have been called'
            );
            assert.strictEqual(
              isDownloadedStub.callCount,
              5,
              'isWebDriverDownloaded not called the correct number of times'
            );
            assert.isTrue(
              isDownloadedStub.calledWith(tunnel.webDriverConfigs[CHROME])
            );
            assert.isTrue(
              isDownloadedStub.calledWith(tunnel.webDriverConfigs[FIREFOX])
            );
            assert.isTrue(
              isDownloadedStub.calledWith(tunnel.webDriverConfigs[SAFARI])
            );
            assert.isTrue(
              isDownloadedStub.calledWith(
                tunnel.webDriverConfigs[INTERNET_EXPLORER]
              )
            );
            assert.isTrue(
              isDownloadedStub.calledWith(
                tunnel.webDriverConfigs[INTERNET_EXPLORER]
              )
            );
          });
        },

        'download with force'() {
          // stub out isWebDriverDownloaded to always return true.
          const isDownloadedStub = (sandbox.stub(
            tunnel as any,
            'isWebDriverDownloaded'
          ) as SinonStub<WebDriverConfig[], boolean>).returns(true);

          return tunnel.download(true).then(() => {
            assert.isFalse(
              isDownloadedStub.called,
              'isWebDriverDownloaded called when it should not have been called'
            );

            // Make sure _downloadFile was called for each webdriver config.
            Object.keys(tunnel.webDriverConfigs).forEach(key => {
              testDownloadFileStubCalledWith(
                downloadFileStub,
                tunnel.webDriverConfigs[key]
              );
            });
          });
        }
      }
    },

    'cancel download'() {
      let cancelled = false;
      const promise = new Promise(() => {});
      tunnel = new WebDriverTunnel({});
      // stub out the (protected) download method so nothing is actually downloaded.
      downloadFileStub = sandbox.stub(
        tunnel as any,
        '_downloadFile'
      ) as DownloadFileStub;
      downloadFileStub.returns(
        new Task(
          () => {
            return promise;
          },
          () => {
            cancelled = true;
          }
        )
      );

      const downloadTask = tunnel.download(true);
      downloadTask.cancel();
      assert.isTrue(cancelled);
    },

    'start/stop': {
      beforeEach() {
        tunnel = new WebDriverTunnel({});
        // stub out the (protected) download method so nothing is actually downloaded.
        webdriverProxyStartStub = sandbox
          .stub(tunnel.webDriverProxy, 'start')
          .returns(Promise.resolve());
        webdriverProxyStopStub = sandbox
          .stub(tunnel.webDriverProxy, 'stop')
          .returns(Promise.resolve());
      },

      tests: {
        start() {
          return (tunnel as any)._start().then(() => {
            assert.isTrue(webdriverProxyStartStub.calledOnce);
            assert.isFalse(webdriverProxyStopStub.calledOnce);
          });
        },

        stop() {
          return (tunnel as any)._stop().then(() => {
            assert.isFalse(webdriverProxyStartStub.calledOnce);
            assert.isTrue(webdriverProxyStopStub.calledOnce);
          });
        }
      }
    },

    'webDriver child factory': {
      beforeEach() {
        tunnel = new WebDriverTunnel({
          port: '9000'
        });

        childProcess = new MockChildProcess();

        sandbox.stub(tunnelChildProcesses, 'makeChildWithCommand').callsFake(
          (_command: string, executor: ChildExecutor): CancellablePromise => {
            return new Task(
              (resolve: () => void, reject: (reason?: any) => void) => {
                executor(childProcess as any, resolve, reject);
              }
            );
          }
        );
      },

      tests: (function() {
        const tests: { [key: string]: () => Promise<any> } = {};
        BROWSER_NAMES.forEach(browserName => {
          tests[`short startupWait with ${browserName}`] = function() {
            tunnel.startupWait = 1;
            return (tunnel as any)
              .createWebDriverChild(browserName)
              .then((webdriver: WebDriver) => {
                assert.strictEqual(webdriver.name, browserName);
                assert.strictEqual(webdriver.port, 9001);
                assert.strictEqual(webdriver.failedInitAttempts, 0);
                assert.exists((webdriver.handle as any).destroy);
                assert.strictEqual(
                  webdriver.process as MockChildProcess,
                  childProcess
                );
              });
          };

          tests[
            `long startupWait with ${browserName}, fire stderr`
          ] = function() {
            tunnel.startupWait = 10000;
            const promise = (tunnel as any)
              .createWebDriverChild(browserName)
              .then(
                (webdriver: WebDriver) => {
                  fail(`task resolved for ${webdriver.name}`);
                },
                (error: Error) => {
                  assert.strictEqual(error.message, 'Forced error');
                }
              );
            childProcess.emit('error', new Error('Forced error'));
            return promise;
          };
        });
        return tests;
      })()
    }
  }
});

function testFileExistsStubCalledWith(
  fileExistsStub: SinonStub<[string], boolean>,
  webDriverConfig: WebDriverConfig
) {
  const expectedPath = join(
    __dirname,
    'test_directory',
    webDriverConfig.directory,
    webDriverConfig.executable
  );
  assert.isTrue(
    fileExistsStub.calledWith(expectedPath),
    `File exists not called with ${webDriverConfig.name} path`
  );
}

function testDownloadFileStubCalledWith(
  downloadFileStub: DownloadFileStub,
  webDriverConfig: WebDriverConfig
) {
  assert.isTrue(
    downloadFileStub.calledWith(webDriverConfig.url, undefined, {
      directory: webDriverConfig.directory,
      dontExtract: webDriverConfig.dontExtract,
      executable: webDriverConfig.executable
    }),
    `_downloadFile not called for "${
      webDriverConfig.name
    }" as it should have been`
  );
}
