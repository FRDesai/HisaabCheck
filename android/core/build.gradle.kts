import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test {
    useJUnitPlatform()
    val repoRoot = rootProject.projectDir.parentFile
    systemProperty("repoRoot", repoRoot.absolutePath)
    // Files outside this module that the tests read: the app's Kotlin sources (banned-text and masking scans), the web
    // core and the differential generator (hashed by the fixture staleness guard) and the shared vectors. Declared as
    // inputs so a change to any of them re-runs the tests instead of leaving the task up to date.
    inputs.dir(repoRoot.resolve("android/app/src")).withPropertyName("appSources").withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(repoRoot.resolve("web/src/core")).withPropertyName("webCore").withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(repoRoot.resolve("shared/test-vectors")).withPropertyName("sharedVectors").withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(file("src/test/differential")).withPropertyName("differentialGenerator").withPathSensitivity(PathSensitivity.RELATIVE)
}
