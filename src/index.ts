import { getDb } from './db/index.js';
import { closeTrackedBuildSessions } from './db/queries/build-cycle.js';
import { SESSION_LOG_END_REASONS } from './entities/build-cycle.js';
import { startBlueprintServer, type BlueprintServerRuntime } from './server.js';
import { startWorkLockWatchdog, type WorkLockWatchdogHandle } from './watchdog.js';

interface ApplicationRuntime {
  readonly serverRuntime: BlueprintServerRuntime | null;
  readonly watchdogHandle: WorkLockWatchdogHandle | null;
}

type ShutdownEndReason = 'done' | 'error';

const ORDERLY_SIGNALS: Array<'SIGINT' | 'SIGTERM'> = ['SIGINT', 'SIGTERM'];

let activeRuntime: ApplicationRuntime = {
  serverRuntime: null,
  watchdogHandle: null,
};

let shutdownPromise: Promise<void> | null = null;

async function stopServerRuntime(serverRuntime: BlueprintServerRuntime | null): Promise<void> {
  if (serverRuntime === null) {
    return;
  }

  await serverRuntime.stop();
}

function stopWatchdog(watchdogHandle: WorkLockWatchdogHandle | null): void {
  if (watchdogHandle === null) {
    return;
  }

  watchdogHandle.stop();
}

function closeRuntimeSessions(endReason: ShutdownEndReason): void {
  const closedCount = closeTrackedBuildSessions(endReason);

  if (closedCount > 0) {
    console.error(`Closed ${closedCount} tracked session log(s) with end_reason=${endReason}`);
  }
}

async function shutdownApplication(endReason: ShutdownEndReason): Promise<void> {
  if (shutdownPromise !== null) {
    return shutdownPromise;
  }

  shutdownPromise = (async (): Promise<void> => {
    const runtimeToStop = activeRuntime;

    activeRuntime = {
      serverRuntime: null,
      watchdogHandle: null,
    };

    let shutdownError: unknown = null;

    try {
      await stopServerRuntime(runtimeToStop.serverRuntime);
    } catch (error: unknown) {
      shutdownError = error;
    }

    try {
      stopWatchdog(runtimeToStop.watchdogHandle);
    } catch (error: unknown) {
      if (shutdownError === null) {
        shutdownError = error;
      }
    }

    try {
      closeRuntimeSessions(endReason);
    } catch (error: unknown) {
      if (shutdownError === null) {
        shutdownError = error;
      }
    }

    if (shutdownError !== null) {
      throw shutdownError;
    }
  })();

  return shutdownPromise;
}

async function handleOrderlyShutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  console.error(`Received ${signal}; shutting down Blueprint`);

  try {
    await shutdownApplication(SESSION_LOG_END_REASONS.DONE);
    process.exit(0);
  } catch (error: unknown) {
    console.error('Error during orderly Blueprint shutdown', error);
    process.exit(1);
  }
}

async function handleFatalRuntimeError(source: string, error: unknown): Promise<void> {
  console.error(`Fatal ${source} in Blueprint`, error);

  try {
    await shutdownApplication(SESSION_LOG_END_REASONS.ERROR);
  } catch (shutdownError: unknown) {
    console.error('Error while closing Blueprint after fatal failure', shutdownError);
  }

  process.exit(1);
}

function registerProcessHandlers(): void {
  for (const signal of ORDERLY_SIGNALS) {
    process.once(signal, (): void => {
      void handleOrderlyShutdown(signal);
    });
  }

  process.once('uncaughtException', (error: Error): void => {
    void handleFatalRuntimeError('uncaught exception', error);
  });

  process.once('unhandledRejection', (reason: unknown): void => {
    void handleFatalRuntimeError('unhandled rejection', reason);
  });
}

async function main(): Promise<void> {
  registerProcessHandlers();
  getDb();

  const watchdogHandle = startWorkLockWatchdog();

  activeRuntime = {
    serverRuntime: null,
    watchdogHandle,
  };

  try {
    const serverRuntime = await startBlueprintServer();

    activeRuntime = {
      serverRuntime,
      watchdogHandle,
    };
  } catch (error: unknown) {
    try {
      await shutdownApplication(SESSION_LOG_END_REASONS.ERROR);
    } catch (shutdownError: unknown) {
      console.error('Error while cleaning up failed Blueprint startup', shutdownError);
    }

    throw error;
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error while starting Blueprint', error);
  process.exit(1);
});
