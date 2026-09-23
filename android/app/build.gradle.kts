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
