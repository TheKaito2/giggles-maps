// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(name: "CapacitorApp", path: "../../../web/node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../web/node_modules/@capacitor/browser"),
        .package(name: "CapacitorFilesystem", path: "../../../web/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorHaptics", path: "../../../web/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorKeyboard", path: "../../../web/node_modules/@capacitor/keyboard"),
        .package(name: "CapacitorShare", path: "../../../web/node_modules/@capacitor/share"),
        .package(name: "CapacitorSplashScreen", path: "../../../web/node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../web/node_modules/@capacitor/status-bar")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar")
            ]
        )
    ]
)
