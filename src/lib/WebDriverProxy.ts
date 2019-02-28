import * as express from 'express';
import * as url from 'url';
import { json } from 'body-parser';
import { Server as HttpServer } from 'http';
import { format } from 'util';
import { Request, Response } from 'express';
import { WebDriver } from '../WebDriverTunnel';
import { stopChildProcess } from './tunnelChildProcesses';
import { request, RequestOptions } from '@theintern/common';

function getSessionIdFromPath(req: Request) {
  const parts = req.path.split('/');
  for (let i = 0, l = parts.length; i < l; i++) {
    const part = parts[i];
    if (part === 'session' && i + 1 < l) {
      return parts[i + 1];
    }
  }
}

function getSessionIdFromBody(body: any): string | undefined {
  if ('id' in body) {
    return body.id;
  }
  if ('sessionId' in body) {
    return body.sessionId;
  }
  if ('value' in body) {
    return getSessionIdFromBody(body.value);
  }
}

interface WebDriverError {
  value: { error: string; message: string };
}

function webDriverErrorFactory(code: string, message: string): WebDriverError {
  return {
    value: {
      error: code,
      message: message
    }
  };
}

export interface WebDriverProxyConfig {
  port: number;
  path: string;
  webDriverChildFactory: (browserName: string) => Promise<WebDriver>;
  maxConnectAttempts: number;
  verbose: boolean;
}

/**
 * An express web server that proxies WebDriver requests between the digdug
 * client and the WebDriver servers.
 */
export default class WebDriverProxy {
  private httpServer!: HttpServer;

  private readonly config: WebDriverProxyConfig;

  // Map of web driver session ID to web driver data.
  private webDriverMap: { [key: string]: WebDriver };

  constructor(config: WebDriverProxyConfig) {
    this.webDriverMap = {};
    this.config = config;
  }

  public start() {
    return new Promise<void>(resolve => {
      const { config } = this;
      const { path, verbose } = config;
      const proxyServer = express();
      const newSessionPath = url.resolve(path, 'session');
      const sessionListPath = url.resolve(path, 'sessions');

      // Middleware that helps with debugging WebDriver servers.  It writes
      // The request bodies and the response bodies to the console.
      if (verbose) {
        proxyServer.use((req, res, next) => {
          console.log('WD Proxy - processing ', req.method, req.url);
          req.on('data', data => {
            console.log('>> request: ', data.toString());
          });
          const origWrite = res.write;
          const origEnd = res.end;
          res.write = (...args: any): boolean => {
            console.log('>> response: ', Buffer.from(args[0]).toString());
            return origWrite.apply(res, args);
          };
          res.end = (...args: any): void => {
            const chunk = args[0];
            if (chunk && typeof chunk !== 'function') {
              console.log('>> response: ', Buffer.from(args[0]).toString());
            }
            origEnd.apply(res, args);
          };
          res.on('finish', () => {
            console.log(
              '>> response status: ',
              res.statusCode,
              res.statusMessage
            );
            console.log(
              '>> response headers: ',
              JSON.stringify(res.getHeaders())
            );
          });
          next();
        });
      }

      proxyServer.use(json());

      proxyServer.get('/*', (req, res) => {
        if (req.path === sessionListPath) {
          const sessions = this.getSessions();
          res.writeHead(200, {
            'content-type': 'application/json;charset=UTF-8'
          });
          res.write(JSON.stringify({ value: sessions }));
          res.end();
        } else {
          this.proxyRequest(req, res);
        }
      });

      proxyServer.put('/*', (req, res) => {
        this.proxyRequest(req, res);
      });

      proxyServer.delete('/*', (req, res) => {
        const sessionId = getSessionIdFromPath(req);
        if (sessionId && sessionId in this.webDriverMap) {
          delete this.webDriverMap[sessionId].sessionInfo;
        }
        this.proxyRequest(req, res);
      });

      proxyServer.post('/*', (req, res) => {
        if (req.path === newSessionPath) {
          this.createSession(req, res);
        } else {
          this.proxyRequest(req, res);
        }
      });

      this.httpServer = proxyServer.listen(config.port, () => {
        console.log(
          format('WebDriver Tunnel listening on port %s.', config.port)
        );
        resolve();
      });
    });
  }

  private createSession(req: Request, res: Response) {
    const { desiredCapabilities = {} } = req.body;
    const { browserName } = desiredCapabilities;
    const { webDriverChildFactory } = this.config;
    if (browserName) {
      webDriverChildFactory(browserName).then(
        (webDriver: WebDriver) => {
          this.requestNewSession(webDriver, req, res);
        },
        message => {
          const errorResponse = webDriverErrorFactory(
            '',
            format('Failed to start WebDriver executable: %s', message)
          );
          res
            .status(500)
            .header('content-type', 'application/json;charset=UTF-8')
            .json(errorResponse);
        }
      );
    }
  }

  private requestNewSession(
    webDriver: WebDriver,
    req: Request,
    res: Response,
    previousError?: WebDriverError
  ) {
    if (this.checkNewSessionError(webDriver, previousError)) {
      this.stopWebDriver(webDriver);
      res
        .status(500)
        .header('content-type', 'application/json;charset=UTF-8')
        .json(previousError);
    } else {
      const reqBody = req.body;
      const wdBody = {
        desiredCapabilities: reqBody.desiredCapabilities,
        capabilities: reqBody.capabilities || reqBody.desiredCapabilities
      };

      request(this.buildTargetUrl(req.path, webDriver), {
        method: 'post',
        data: wdBody,
        handleAs: 'json',
        headers: {
          accept: 'application/json;charset=UTF-8',
          'content-type': 'application/json;charset=UTF-8'
        }
      }).then(
        wdRes => {
          wdRes.json().then(data => {
            const errorResponse = this.handleNewSessionResponse(
              webDriver,
              data
            );
            if (errorResponse) {
              this.requestNewSession(webDriver, req, res, errorResponse);
            } else {
              res
                .header('content-type', 'application/json;charset=UTF-8')
                .json(data);
            }
          });
        },
        error => {
          // A connection error occurred.
          const errorResponse = webDriverErrorFactory(
            'session not created',
            format('WebDriver connection error: %s', error)
          );
          this.requestNewSession(webDriver, req, res, errorResponse);
        }
      );
    }
  }

  private checkNewSessionError(webDriver: WebDriver, error?: WebDriverError) {
    if (!error) {
      return false;
    }
    if (this.config.verbose) {
      console.log(
        format('WebDriver new session request error: %s.', error.value.message)
      );
    }

    webDriver.failedInitAttempts++;
    return webDriver.failedInitAttempts >= this.config.maxConnectAttempts;
  }

  private handleNewSessionResponse(webDriver: WebDriver, data: any) {
    let sessionId;
    let errorResponse;
    const newSessionInfo = data as {
      value: { error?: string };
    };
    if (newSessionInfo) {
      sessionId = getSessionIdFromBody(newSessionInfo);
      if (sessionId) {
        // Session info was returned, cache it.
        webDriver.sessionInfo = newSessionInfo;
        this.webDriverMap[sessionId] = webDriver;
      } else {
        // No session information was found.  Look for an error.
        if (newSessionInfo.value && newSessionInfo.value.error) {
          // Return the error the WebDriver server returned.
          errorResponse = newSessionInfo as WebDriverError;
        } else {
          errorResponse = webDriverErrorFactory(
            'session not created',
            format(
              'Request for a new %s session did not return session information.',
              webDriver.name
            )
          );
        }
      }
    } else {
      // No payload was returned.
      errorResponse = webDriverErrorFactory(
        'session not created',
        format(
          'Request for a new %s session did not return session information.',
          webDriver.name
        )
      );
    }
    return errorResponse;
  }

  public stop() {
    const { webDriverMap } = this;

    // Stop the child processes.
    Object.keys(webDriverMap).forEach(sessionId => {
      this.stopWebDriver(webDriverMap[sessionId]);
    });

    this.webDriverMap = {};

    return new Promise<void>(resolve => {
      const { httpServer } = this;
      if (httpServer) {
        httpServer.close(() => {
          console.log('WebDriver Tunnel stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private stopWebDriver(webDriver: WebDriver) {
    webDriver.handle && webDriver.handle.destroy();
    // Don't wait for the proesses to stop.
    stopChildProcess(webDriver.process);
  }

  private proxyRequest(req: Request, res: Response) {
    const sessionId = getSessionIdFromPath(req);
    const { query, headers, body } = req;
    if (sessionId) {
      const webDriver = this.webDriverMap[sessionId];
      const method = req.method.toLowerCase();
      const requestOptions: RequestOptions = {
        method: method as any,
        query: query,
        headers: headers as any
      };

      // Some webdriver servers don't like when the http client includes a
      // body when one is not expected.
      if (method === 'post' || method === 'put') {
        requestOptions.data = body;
      }

      request(this.buildTargetUrl(req.path, webDriver), requestOptions).then(
        response => {
          response.text().then(data => {
            res.writeHead(response.status, response.headers.all);
            res.write(data);
            res.end();
          });
        },
        error => {
          res
            .status(500)
            .header('content-type', 'application/json;charset=UTF-8')
            .json(webDriverErrorFactory('unknown error', error));
        }
      );
    }
  }

  private buildTargetUrl(path: string, webDriver: WebDriver) {
    const targetHostPort = format('http://localhost:%s', webDriver.port);
    // Not all of the child web driver executables support base url parameters so remove the one intern is using with the tunnel.
    return url.resolve(targetHostPort, path.replace(this.config.path, ''));
  }

  /**
   * Provides a list of the active session data returned by each server when the sessions were started.
   */
  private getSessions() {
    const { webDriverMap } = this;
    const sessions: WebDriver[] = [];
    Object.keys(webDriverMap).forEach(sessionId => {
      const { sessionInfo } = webDriverMap[sessionId];
      if (sessionInfo) {
        sessions.push(sessionInfo);
      }
    });
    return sessions;
  }
}
