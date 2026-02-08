/**
 * Utility tool handlers: wait, screenshot, console_logs, evaluate, get_html, resize_viewport, upload_file.
 */
import { log } from '@/utils/logger';
import { schemas } from '../schemas';
import type { HandlerContext, HandlerMap } from './types';

export function createUtilityHandlers(ctx: HandlerContext): HandlerMap {
  const { getSelector } = ctx;

  return {
    browser_wait: async (payload) => {
      const { time } = schemas.browser_wait.parse(payload);
      await new Promise(resolve => setTimeout(resolve, time * 1000));
      return { waited: time };
    },

    browser_screenshot: async () => {
      const result = await ctx.tabManager.sendDebuggerCommand<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png' }
      );

      return {
        image: `data:image/png;base64,${result.data}`,
      };
    },

    browser_get_console_logs: async () => {
      return { logs: [] };
    },

    browser_evaluate: async (payload) => {
      const { code } = schemas.browser_evaluate.parse(payload);
      log.info('[browser_evaluate] Evaluating via CDP:', code.substring(0, 50));

      try {
        const result = await ctx.tabManager.sendDebuggerCommand<{
          result: { type: string; value?: unknown; description?: string };
          exceptionDetails?: { text: string; exception?: { description: string } };
        }>('Runtime.evaluate', {
          expression: code,
          returnByValue: true,
          awaitPromise: true,
        });

        if (result.exceptionDetails) {
          const errMsg = result.exceptionDetails.exception?.description ||
                         result.exceptionDetails.text ||
                         'Unknown evaluation error';
          throw new Error(`Evaluation failed: ${errMsg}`);
        }

        log.info('[browser_evaluate] Result type:', result.result?.type);
        return result.result?.value ?? null;
      } catch (error) {
        log.error('[browser_evaluate] CDP evaluation failed:', error);
        throw error;
      }
    },

    browser_get_html: async () => {
      log.info('[browser_get_html] Getting HTML via CDP DOM.getOuterHTML');

      const { root } = await ctx.tabManager.sendDebuggerCommand<{ root: { nodeId: number } }>(
        'DOM.getDocument',
        { depth: 0 }
      );

      const { outerHTML } = await ctx.tabManager.sendDebuggerCommand<{ outerHTML: string }>(
        'DOM.getOuterHTML',
        { nodeId: root.nodeId }
      );

      log.info('[browser_get_html] Got HTML, length:', outerHTML.length);
      return { html: outerHTML };
    },

    browser_resize_viewport: async (payload) => {
      const { width, height } = schemas.browser_resize_viewport.parse(payload);

      await ctx.tabManager.sendDebuggerCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      return { width, height };
    },

    browser_upload_file: async (payload) => {
      const { ref, selector, filePath } = schemas.browser_upload_file.parse(payload);

      let targetSelector = selector;
      if (!targetSelector && ref) {
        targetSelector = await getSelector(ref);
      }

      if (!targetSelector) {
        throw new Error('Either ref or selector must be provided');
      }

      const doc = await ctx.tabManager.sendDebuggerCommand<{ root: { nodeId: number } }>(
        'DOM.getDocument',
        {}
      );

      const node = await ctx.tabManager.sendDebuggerCommand<{ nodeId: number }>(
        'DOM.querySelector',
        {
          nodeId: doc.root.nodeId,
          selector: targetSelector,
        }
      );

      if (!node.nodeId) {
        throw new Error(`Element not found: ${targetSelector}`);
      }

      await ctx.tabManager.sendDebuggerCommand('DOM.setFileInputFiles', {
        nodeId: node.nodeId,
        files: [filePath],
      });

      return { uploaded: true, filePath };
    },
  };
}
