plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.naimul.screentime"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.naimul.screentime"
        // API 29. UsageStats.getTotalTimeVisible() and
        // getTotalTimeForegroundServiceUsed() were both added in 29, and this
        // project needs them to keep foreground time separable from
        // foreground-SERVICE time -- which measured 2.07x screen-on and is the
        // single easiest way to report nonsense. Verified present in
        // android-37.0/android.jar rather than assumed.
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    // BuildConfig is off by default from AGP 8; Uploader reports the app
    // version so a stale build on the phone is visible in the dashboard rather
    // than being guessed at.
    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        // Debug is what actually gets installed: this app is sideloaded onto
        // one phone over adb and never published, so a release signing config
        // would be ceremony with no reader.
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

/*
  NO DEPENDENCIES. Deliberately, and for the same reason as node:sqlite in the
  dashboard: this must still build years from now from whatever is on disk.
  JobScheduler does periodic work with a network constraint and survives
  reboots, which is the entire requirement, and costs nothing to resolve.
*/
dependencies { }
