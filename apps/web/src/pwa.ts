import { registerSW } from "virtual:pwa-register";

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info("Issue Prompt Tracker is ready for offline use.");
  },
  onNeedRefresh() {
    console.info("New version available. Reload the app to update.");
  }
});
