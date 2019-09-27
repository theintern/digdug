import * as common from '@theintern/common';
import { createSandbox, SinonSandbox, SinonStub } from 'sinon';

import * as util from '../../src/lib/util';
import SeleniumTunnel, {
  DEFAULT_WEBDRIVER_CONFIG_URL
} from '../../src/SeleniumTunnel';

registerSuite('unit/SeleniumTunnel', {
  config: {
    'name only': function() {
      const tunnel = new SeleniumTunnel({ drivers: ['chrome'] });
      assert.isFalse(tunnel.isDownloaded);
    },

    'config object': function() {
      const tunnel = new SeleniumTunnel({
        drivers: [{ executable: 'README.md', url: '', seleniumProperty: '' }]
      });
      Object.defineProperty(tunnel, 'artifact', { value: '.' });
      Object.defineProperty(tunnel, 'directory', { value: '.' });
      assert.isTrue(tunnel.isDownloaded);
    },

    'invalid name': function() {
      assert.throws(function() {
        const tunnel = new SeleniumTunnel({ drivers: <any>['foo'] });
        Object.defineProperty(tunnel, 'artifact', { value: '.' });
        Object.defineProperty(tunnel, 'directory', { value: '.' });
        tunnel.isDownloaded;
      }, /Invalid driver/);
    },

    'config object with invalid name': function() {
      assert.throws(function() {
        const tunnel = new SeleniumTunnel({
          drivers: [{ name: 'foo' }]
        });
        Object.defineProperty(tunnel, 'artifact', { value: '.' });
        Object.defineProperty(tunnel, 'directory', { value: '.' });
        tunnel.isDownloaded;
      }, /Invalid driver/);
    },

    'debug args': (function() {
      function createTest(version: string, hasDebugArg: boolean) {
        return function() {
          const tunnel = new SeleniumTunnel({
            version,
            verbose: true
          });
          console.log = () => {};
          const args = tunnel['_makeArgs']();
          console.log = oldLog;
          const indexOfDebug = args.indexOf('-debug');
          assert.notEqual(
            indexOfDebug,
            -1,
            'expected -debug arg to be present'
          );
          if (hasDebugArg) {
            assert.equal(
              args[indexOfDebug + 1],
              'true',
              "-debug should have 'true' value"
            );
          } else {
            assert.notEqual(
              args[indexOfDebug + 1],
              'true',
              "-debug should not have 'true' value"
            );
          }
        };
      }

      let oldLog = console.log;

      return {
        afterEach() {
          console.log = oldLog;
        },
        '3.0.0': createTest('3.0.0', false),
        '3.5.0': createTest('3.5.0', false),
        '3.14.0': createTest('3.14.0', false),
        '3.141.59': createTest('3.141.59', false)
      };
    })()
  },

  webdriverConfigUrl: (() => {
    let sandbox: SinonSandbox;
    let request: SinonStub;

    return {
      before() {
        sandbox = createSandbox();
        request = (sandbox.stub(common, 'request').resolves({
          status: 200,
          arrayBuffer: () => Promise.resolve([])
        } as any) as unknown) as SinonStub;
        sandbox.stub(util, 'writeFile');
      },

      afterEach() {
        sandbox.resetHistory();
      },

      after() {
        sandbox.restore();
      },

      tests: {
        default() {
          const tunnel = new SeleniumTunnel();
          tunnel.download();
          assert.equal(request.callCount, 1);
          assert.equal(
            request.getCall(0).args[0],
            DEFAULT_WEBDRIVER_CONFIG_URL
          );
        },

        custom() {
          const webdriverConfigUrl = 'http://info.local';
          const tunnel = new SeleniumTunnel({ webdriverConfigUrl });
          tunnel.download();
          assert.equal(request.callCount, 1);
          assert.equal(request.getCall(0).args[0], webdriverConfigUrl);
        },

        disabled() {
          const tunnel = new SeleniumTunnel({ webdriverConfigUrl: false });
          tunnel.download();
          assert.equal(request.callCount, 0);
        }
      }
    };
  })()
});
