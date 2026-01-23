/**
 * Shared Chrome runtime messaging helper.
 */

export async function sendMessage<T>(action: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response === undefined) {
        reject(new Error('No response from background script'));
      } else {
        resolve(response as T);
      }
    });
  });
}
