import { ChildProcess, spawn } from 'child_process';
import { kill, on } from './util';
import {
  CancellablePromise,
  createCompositeHandle,
  Handle,
  Task
} from '@theintern/common';
import { ChildExecutor } from '../Tunnel';

/**
 * Creates a newly spawned child process for the tunnel software.
 * Implementations should call this method to create the tunnel process.
 *
 * Arguments passed to this method will be passed as-is to
 * [[Tunnel._makeArgs]] and [[Tunnel._makeOptions]].
 *
 * @returns An object containing a newly spawned Process and a Deferred that
 * will be resolved once the tunnel has started successfully.
 */
export function makeChildWithCommand(
  command: string,
  executor: ChildExecutor,
  args: string[],
  options: any
): CancellablePromise {
  const child = spawn(command, args, options);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let handle: Handle;
  let canceled = false;

  // Ensure child process is killed when parent exits
  process.on('exit', () => kill(child.pid));
  process.on('SIGINT', () => kill(child.pid));

  const task = new Task(
    (resolve, reject) => {
      let errorMessage = '';
      let exitCode: number | undefined;
      let stderrClosed = false;
      let exitted = false;

      function handleChildExit() {
        reject(
          new Error(
            `Tunnel failed to start: ${errorMessage ||
              `Exit code: ${exitCode}`}`
          )
        );
      }

      handle = createCompositeHandle(
        on(child, 'error', reject),

        on(child.stderr, 'data', (data: string) => {
          errorMessage += data;
        }),

        on(child, 'exit', () => {
          exitted = true;
          if (stderrClosed) {
            handleChildExit();
          }
        }),

        // stderr might still have data in buffer at the time the
        // exit event is sent, so we have to store data from stderr
        // and the exit code and reject only once stderr closes
        on(child.stderr, 'close', () => {
          stderrClosed = true;
          if (exitted) {
            handleChildExit();
          }
        })
      );

      const result = executor(child, resolve, reject);
      if (result) {
        handle = createCompositeHandle(handle, result);
      }
    },
    () => {
      canceled = true;

      // Make a best effort to kill the process, but don't throw
      // exceptions
      try {
        kill(child.pid);
      } catch (error) {}
    }
  );

  return task.finally(() => {
    handle.destroy();
    if (canceled) {
      // We only want this to run when cancelation has occurred
      return new Promise(resolve => {
        child.once('exit', () => {
          resolve();
        });
      });
    }
  });
}

export function stopChildProcess(
  childProcess: ChildProcess | undefined,
  resolve?: (data?: any) => void,
  reject?: (reason: any) => void
) {
  if (!childProcess) {
    resolve && resolve();
    return;
  }

  childProcess.once('exit', code => {
    resolve && resolve(code == null ? undefined : code);
  });

  try {
    kill(childProcess.pid);
  } catch (error) {
    reject && reject(error);
  }
}
