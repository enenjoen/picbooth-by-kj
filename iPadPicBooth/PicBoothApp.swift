import SwiftUI

@main
struct PicBoothApp: App {
    @StateObject private var camera = CameraController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(camera)
                .onAppear { camera.start() }
        }
    }
}
