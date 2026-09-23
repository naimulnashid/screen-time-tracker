import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.naimul.screentime"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.naimul.screentime"
        // API 27, for the Redmi 5 Plus (Android 8.1). It was 29, justified
        // by getTotalTimeVisible() and getTotalTimeForegroundServiceUsed() --
        // but the app reads EVENTS only and calls neither, so that reason
        // went when the daily rollup did.
        //
        // What 27 loses is not an API call but DATA: SCREEN_INTERACTIVE /
        // NON_INTERACTIVE and KEYGUARD_SHOWN / HIDDEN were added in 28, so an
        // 8.x phone sends app sessions and no screen spans at all. Measured
        // 2026-09-23 on the Redmi: MOVE_TO_FOREGROUND / MOVE_TO_BACKGROUND
        // only -- the same constants (1, 2) that 29 renamed ACTIVITY_RESUMED
        // / PAUSED. The dashboard switches that device's headline to app time.
        // Lint's NewApi check (run by assembleRelease) guards the rest.
        minSdk = 27
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"
    }

    // BuildConfig is off by default from AGP 8; Uploader reports the app
    // version so a stale build on the phone is visible in the dashboard rather
    // than being guessed at.
    buildFeatures {
        buildConfig = true
    }

    // The release APK is published on GitHub Releases, so it is signed with a
    // real key. The key and its passwords are LOCAL ONLY: android/
    // keystore.properties (gitignored) names the .jks and holds the
    // passwords, and a copy of both lives in <scratchDir>\recovery\. Losing
    // the key means a new release cannot install over the old one; the app
    // would have to be uninstalled first.
    //
    // Without the file, assembleRelease still builds, UNSIGNED, and says so,
    // so a fresh clone is buildable and nobody is handed a debug-signed
    // "release".
    val keystoreProps = rootProject.file("keystore.properties")
    val signing = Properties().apply {
        if (keystoreProps.exists()) keystoreProps.inputStream().use { load(it) }
    }
    signingConfigs {
        if (keystoreProps.exists()) {
            create("release") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        } else {
            logger.warn("android/keystore.properties not found: the release APK will be UNSIGNED")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
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
