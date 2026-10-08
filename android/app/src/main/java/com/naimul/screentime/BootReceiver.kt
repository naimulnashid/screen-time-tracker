package com.naimul.screentime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-register the jobs after a reboot, and after an update.
 *
 * `setPersisted(true)` is supposed to make this unnecessary, and on a stock
 * build it does. It is here because the Windows half already learned this
 * lesson the expensive way: a scheduled task whose trigger quietly stopped
 * firing produced no error anywhere, and nothing collected for days. Belt and
 * braces on the one mechanism whose silent failure mode is "no data".
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // MY_PACKAGE_REPLACED so an update that adds a job (SyncWatchdog came
        // in 1.2) books it without waiting for the app to be opened.
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return
        if (Prefs(context).isConfigured) {
            SyncJobService.schedule(context)
            SyncWatchdog.schedule(context)
        }
    }
}
