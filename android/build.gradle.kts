// Versions pinned to what is already in the Gradle cache on this machine, so a
// rebuild after a Windows reset does not depend on resolving anything new.
// These match the sibling Data Usage Tracker deliberately: two Android projects
// on one machine sharing a cache is the cheapest way to keep both buildable.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
}
