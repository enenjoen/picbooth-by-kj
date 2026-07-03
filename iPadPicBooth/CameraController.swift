import Foundation
import ImageCaptureCore
import UIKit

@MainActor
final class CameraController: NSObject, ObservableObject {
    @Published private(set) var status = "请用 USB-C OTG 连接 Canon 600D"
    @Published private(set) var cameraName = ""
    @Published private(set) var isReady = false
    @Published private(set) var isCapturing = false
    @Published private(set) var latestImage: UIImage?
    @Published private(set) var livePreview: UIImage?

    private let browser = ICDeviceBrowser()
    private var camera: ICCameraDevice?
    private var transactionID: UInt32 = 1
    private var captureContinuation: CheckedContinuation<UIImage, Error>?
    private var captureToken: UUID?
    private var pendingDownloadURL: URL?
    private var isPTPDownloadInProgress = false
    private var isPreparingCanonRemote = false
    private var canonRemoteReady = false
    private var liveViewTask: Task<Void, Never>?
    private var catalogProgressTask: Task<Void, Never>?

    func start() {
        browser.delegate = self
        browser.browsedDeviceTypeMask = .camera
        browser.start()
    }

    func stop() {
        liveViewTask?.cancel()
        liveViewTask = nil
        catalogProgressTask?.cancel()
        catalogProgressTask = nil
        browser.stop()
        camera?.ptpEventHandler = { _ in }
        camera?.requestCloseSession()
    }

    func capture() async throws -> UIImage {
        guard let camera, isReady else { throw BoothCameraError.notConnected }
        guard captureContinuation == nil else { throw BoothCameraError.busy }

        liveViewTask?.cancel()
        liveViewTask = nil
        isCapturing = true
        status = "正在拍摄…"
        let token = UUID()
        captureToken = token
        return try await withCheckedThrowingContinuation { continuation in
            captureContinuation = continuation

            Task { @MainActor [weak self, weak camera] in
                guard let self, let camera, self.captureToken == token else { return }
                do {
                    let image = try await self.performCanonCapture(with: camera, token: token)
                    guard self.captureToken == token else { return }
                    self.latestImage = image
                    self.finishCapture(.success(image))
                } catch {
                    self.finishCapture(.failure(error))
                }
            }

            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard let self, self.captureToken == token else { return }
                self.finishCapture(.failure(BoothCameraError.timedOut))
            }
        }
    }

    @discardableResult
    private func sendPTPCommand(
        _ operation: PTPOperation,
        params: [UInt32],
        outData: Data? = nil,
        to camera: ICCameraDevice
    ) async throws -> PTPResult {
        let command = makePTPCommand(operation, params: params)
        return try await withCheckedThrowingContinuation { continuation in
            camera.requestSendPTPCommand(command, outData: outData) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let code = Self.ptpResponseCode(from: response)
                if code == 0x2001 || code == nil {
                    continuation.resume(returning: PTPResult(data: data, response: response))
                } else {
                    continuation.resume(throwing: BoothCameraError.ptpFailed(Self.ptpResponseMessage(code)))
                }
            }
        }
    }

    private func makePTPCommand(_ operation: PTPOperation, params: [UInt32]) -> Data {
        var data = Data()
        data.appendLittleEndian(UInt32(12 + params.count * 4))
        data.appendLittleEndian(UInt16(1))
        data.appendLittleEndian(operation.rawValue)
        data.appendLittleEndian(transactionID)
        for param in params {
            data.appendLittleEndian(param)
        }
        transactionID &+= 1
        return data
    }

    nonisolated private static func ptpResponseCode(from response: Data?) -> UInt16? {
        guard let response, response.count >= 6 else { return nil }
        let length = Int(response.uint32LE(at: 0))
        let type = response.uint16LE(at: 4)
        if length == response.count, type == 3, response.count >= 8 {
            return response.uint16LE(at: 6)
        }
        return response.uint16LE(at: 0)
    }

    nonisolated private static func ptpResponseMessage(_ code: UInt16?) -> String {
        guard let code else { return "PTP 未返回状态" }
        switch code {
        case 0x2001: return "OK"
        case 0x2002: return "General Error"
        case 0x2005: return "Operation Not Supported"
        case 0x2006: return "Parameter Not Supported"
        case 0x2009: return "Invalid Object Handle"
        case 0x200A: return "Device Prop Not Supported"
        case 0x2019: return "Device Busy"
        case 0x201A: return "Invalid Parent Object"
        case 0x201B: return "Invalid Device Prop Format"
        case 0x201D: return "Invalid Parameter"
        default: return "PTP response 0x\(String(code, radix: 16, uppercase: true))"
        }
    }

    private func download(_ file: ICCameraFile, from camera: ICCameraDevice) {
        guard captureContinuation != nil, pendingDownloadURL == nil else { return }
        let name = "booth-\(UUID().uuidString).jpg"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        pendingDownloadURL = url
        status = "正在下载照片…"
        let options: [ICDownloadOption: Any] = [
            .downloadsDirectoryURL: FileManager.default.temporaryDirectory,
            .saveAsFilename: name,
            .overwrite: true
        ]
        camera.requestDownloadFile(
            file,
            options: options,
            downloadDelegate: self,
            didDownloadSelector: #selector(didDownloadFile(_:error:options:contextInfo:)),
            contextInfo: nil
        )
    }

    @objc nonisolated func didDownloadFile(
        _ file: ICCameraFile,
        error: Error?,
        options: [String: Any],
        contextInfo: UnsafeMutableRawPointer?
    ) {
        Task { @MainActor in
            if let error {
                self.finishCapture(.failure(error))
                return
            }
            guard let url = self.pendingDownloadURL, let image = UIImage(contentsOfFile: url.path) else {
                self.finishCapture(.failure(BoothCameraError.cannotReadPhoto))
                return
            }
            self.latestImage = image
            self.finishCapture(.success(image))
        }
    }

    private func finishCapture(_ result: Result<UIImage, Error>) {
        guard let continuation = captureContinuation else { return }
        captureContinuation = nil
        captureToken = nil
        pendingDownloadURL = nil
        isCapturing = false
        if let camera, canonRemoteReady {
            startLiveView(on: camera)
        }
        switch result {
        case .success(let image):
            status = "拍摄完成"
            continuation.resume(returning: image)
        case .failure(let error):
            status = error.localizedDescription
            continuation.resume(throwing: error)
        }
    }
}

extension CameraController: ICDeviceBrowserDelegate {
    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let camera = device as? ICCameraDevice else { return }
        Task { @MainActor in
            self.camera = camera
            camera.delegate = self
            camera.ptpEventHandler = { [weak self, weak camera] eventData in
                Task { @MainActor in
                    guard let self, let camera else { return }
                    self.handlePTPEvent(eventData, from: camera)
                }
            }
            self.cameraName = camera.name ?? "Canon 相机"
            self.status = "正在连接 \(self.cameraName)…"
            camera.requestOpenSession()
        }
    }

    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        Task { @MainActor in
            guard self.camera === device else { return }
            self.camera = nil
            self.isReady = false
            self.canonRemoteReady = false
            self.isPreparingCanonRemote = false
            self.liveViewTask?.cancel()
            self.liveViewTask = nil
            self.catalogProgressTask?.cancel()
            self.catalogProgressTask = nil
            self.livePreview = nil
            self.cameraName = ""
            self.status = "相机已断开"
            self.finishCapture(.failure(BoothCameraError.disconnected))
        }
    }
}

extension CameraController: ICCameraDeviceDelegate, ICCameraDeviceDownloadDelegate {
    nonisolated func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
        Task { @MainActor in
            if let error {
                self.status = "相机连接失败：\(error.localizedDescription)"
            } else {
                self.isReady = false
                guard let camera = device as? ICCameraDevice else { return }
                self.startCatalogProgress(for: camera)
            }
        }
    }

    nonisolated func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
        Task { @MainActor in self.isReady = false }
    }

    nonisolated func didRemove(_ device: ICDevice) {
        Task { @MainActor in
            self.camera = nil
            self.isReady = false
            self.canonRemoteReady = false
            self.isPreparingCanonRemote = false
            self.liveViewTask?.cancel()
            self.liveViewTask = nil
            self.catalogProgressTask?.cancel()
            self.catalogProgressTask = nil
            self.livePreview = nil
            self.status = "相机已断开"
        }
    }

    nonisolated func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {
        // Do not use ImageCaptureCore's catalogue callback here. During initial
        // enumeration it can report an old SD-card item while a capture is active.
        // Canon EOS GetEvent supplies the exact handle for the current shot.
    }

    nonisolated func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {}
    nonisolated func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {}
    nonisolated func cameraDevice(_ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?, for item: ICCameraItem, error: Error?) {}
    nonisolated func cameraDevice(_ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?, for item: ICCameraItem, error: Error?) {}
    nonisolated func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {}
    nonisolated func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {}
    nonisolated func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
        Task { @MainActor in
            guard self.camera === device else { return }
            self.catalogProgressTask?.cancel()
            self.catalogProgressTask = nil
            if self.canonRemoteReady {
                self.isReady = true
                self.status = "\(self.cameraName) · Canon EOS 遥控已就绪"
            } else {
                await self.prepareCanonRemote(device)
            }
        }
    }
    nonisolated func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {}
    nonisolated func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {}
}

private extension CameraController {
    func startCatalogProgress(for camera: ICCameraDevice) {
        catalogProgressTask?.cancel()
        status = "\(cameraName) 已连接 · 正在初始化相机…"

        catalogProgressTask = Task { @MainActor [weak self, weak camera] in
            while !Task.isCancelled, let self, let camera, self.camera === camera {
                let progress = min(max(camera.contentCatalogPercentCompleted, 0), 100)
                self.status = "\(self.cameraName) · 正在初始化相机 \(progress)%（请等红灯熄灭）"
                if progress >= 100 {
                    self.catalogProgressTask = nil
                    await self.prepareCanonRemote(camera)
                    return
                }
                try? await Task.sleep(for: .milliseconds(350))
            }
        }
    }

    func prepareCanonRemote(_ camera: ICCameraDevice) async {
        guard self.camera === camera, !canonRemoteReady, !isPreparingCanonRemote else { return }
        isPreparingCanonRemote = true
        isReady = false
        status = "\(cameraName) 已连接 · 正在启动 Canon EOS 遥控…"
        defer { isPreparingCanonRemote = false }

        var lastError: Error?
        for attempt in 0..<30 {
            guard self.camera === camera else { return }
            do {
                try await sendPTPCommand(.canonSetRemoteMode, params: [1], to: camera)
                try await sendPTPCommand(.canonSetEventMode, params: [1], to: camera)
                _ = try? await canonEvents(from: camera)
                canonRemoteReady = true
                isReady = true
                status = "\(cameraName) · Canon EOS 遥控已就绪"
                await enableLiveView(on: camera)
                startLiveView(on: camera)
                return
            } catch {
                lastError = error
                if case BoothCameraError.ptpFailed(let message) = error,
                   message.contains("Device Busy") {
                    status = "\(cameraName) 正在准备遥控拍摄… \(attempt + 1)/30"
                    try? await Task.sleep(for: .milliseconds(500))
                    continue
                }
                break
            }
        }

        canonRemoteReady = false
        isReady = false
        status = BoothCameraError.canonSetupFailed(
            lastError?.localizedDescription ?? "相机没有响应"
        ).localizedDescription
    }

    func performCanonCapture(with camera: ICCameraDevice, token: UUID) async throws -> UIImage {
        guard canonRemoteReady else { throw BoothCameraError.canonNotReady }

        // Clear stale Canon EOS events so only this shutter press is handled.
        for _ in 0..<3 {
            let data = try await canonEvents(from: camera)
            if canonObjectHandles(in: data).isEmpty, data.isEmpty { break }
        }

        do {
            // Regular EOS bodies: half press, full press, then release both.
            try await sendPTPCommand(.canonRemoteReleaseOn, params: [1, 0], to: camera)
            try? await Task.sleep(for: .milliseconds(120))
            try await sendPTPCommand(.canonRemoteReleaseOn, params: [2, 0], to: camera)
            try await sendPTPCommand(.canonRemoteReleaseOff, params: [2], to: camera)
            try await sendPTPCommand(.canonRemoteReleaseOff, params: [1], to: camera)
        } catch {
            // Early EOS firmware (including some 600D revisions) exposes the
            // older one-shot RemoteRelease operation instead.
            if case BoothCameraError.ptpFailed(let message) = error,
               message.contains("Operation Not Supported") {
                try await sendPTPCommand(.canonRemoteRelease, params: [], to: camera)
            } else {
                _ = try? await sendPTPCommand(.canonRemoteReleaseOff, params: [2], to: camera)
                _ = try? await sendPTPCommand(.canonRemoteReleaseOff, params: [1], to: camera)
                throw error
            }
        }

        status = "快门已触发，正在接收照片…"
        let deadline = Date().addingTimeInterval(30)
        var lastError: Error?

        while Date() < deadline {
            guard captureToken == token else { throw BoothCameraError.disconnected }
            do {
                let eventData = try await canonEvents(from: camera)
                for handle in canonObjectHandles(in: eventData) {
                    if let image = try await imageObject(handle: handle, from: camera) {
                        return image
                    }
                }
            } catch {
                lastError = error
                if case BoothCameraError.ptpFailed(let message) = error,
                   message.contains("Device Busy") {
                    try? await Task.sleep(for: .milliseconds(250))
                    continue
                }
            }
            try? await Task.sleep(for: .milliseconds(250))
        }

        if let lastError { throw lastError }
        throw BoothCameraError.timedOut
    }

    func enableLiveView(on camera: ICCameraDevice) async {
        // EOS SetDevicePropValueEx payload: byte count, property code, value.
        // EVF mode 1 = enabled; output device 2 = host/iPad.
        _ = try? await setCanonProperty(0xD1B1, uint16: 1, on: camera)
        _ = try? await setCanonProperty(0xD1B0, uint32: 2, on: camera)
        _ = try? await canonEvents(from: camera)
    }

    func startLiveView(on camera: ICCameraDevice) {
        liveViewTask?.cancel()
        guard canonRemoteReady, self.camera === camera else { return }

        liveViewTask = Task { @MainActor [weak self, weak camera] in
            while !Task.isCancelled, let self, let camera, self.camera === camera {
                if self.isCapturing {
                    try? await Task.sleep(for: .milliseconds(150))
                    continue
                }

                do {
                    let result = try await self.sendPTPCommand(
                        .canonGetViewFinderData,
                        params: [0x0020_0000, 0, 0],
                        to: camera
                    )
                    if let data = result.data,
                       let image = self.liveViewImage(from: data) {
                        self.livePreview = image
                    }
                } catch {
                    // EOS returns Device Busy/A102 while its mirror is entering
                    // Live View. Keep trying without disturbing the booth UI.
                }
                try? await Task.sleep(for: .milliseconds(110))
            }
        }
    }

    func setCanonProperty(_ property: UInt32, uint32 value: UInt32, on camera: ICCameraDevice) async throws {
        var payload = Data()
        payload.appendLittleEndian(UInt32(12))
        payload.appendLittleEndian(property)
        payload.appendLittleEndian(value)
        try await sendPTPCommand(.canonSetDevicePropValueEx, params: [], outData: payload, to: camera)
    }

    func setCanonProperty(_ property: UInt32, uint16 value: UInt16, on camera: ICCameraDevice) async throws {
        var payload = Data()
        payload.appendLittleEndian(UInt32(12))
        payload.appendLittleEndian(property)
        payload.appendLittleEndian(value)
        payload.appendLittleEndian(UInt16(0))
        try await sendPTPCommand(.canonSetDevicePropValueEx, params: [], outData: payload, to: camera)
    }

    func liveViewImage(from data: Data) -> UIImage? {
        let payload = ptpPayload(from: data)
        var offset = 0
        while offset + 8 <= payload.count {
            let length = Int(payload.uint32LE(at: offset))
            let type = payload.uint32LE(at: offset + 4)
            guard length >= 8, offset + length <= payload.count else { break }
            if type == 1 || type == 11 {
                let jpeg = payload.subdata(in: (offset + 8)..<(offset + length))
                if let image = UIImage(data: jpeg) { return image }
            }
            offset += length
        }

        if let image = UIImage(data: payload) { return image }
        guard let start = payload.range(of: Data([0xFF, 0xD8]))?.lowerBound,
              let endRange = payload.range(of: Data([0xFF, 0xD9]), options: .backwards),
              endRange.upperBound > start else { return nil }
        return UIImage(data: payload.subdata(in: start..<endRange.upperBound))
    }

    func canonEvents(from camera: ICCameraDevice) async throws -> Data {
        let result = try await sendPTPCommand(.canonGetEvent, params: [], to: camera)
        guard let data = result.data else { return Data() }
        return ptpPayload(from: data)
    }

    func canonObjectHandles(in data: Data) -> [UInt32] {
        var handles: [UInt32] = []
        var offset = 0

        while offset + 8 <= data.count {
            let size = Int(data.uint32LE(at: offset))
            let code = data.uint32LE(at: offset + 4)
            guard size >= 8, offset + size <= data.count else { break }

            switch code {
            case 0xC181, // ObjectAddedEx
                 0xC186, // RequestObjectTransfer
                 0xC1A7, // ObjectAddedEx64
                 0xC1A9, // RequestObjectTransfer64
                 0xC1B8: // RequestObjectTransfer64LFN
                if size >= 12 {
                    let handle = data.uint32LE(at: offset + 8)
                    if handle != 0, !handles.contains(handle) {
                        handles.append(handle)
                    }
                }
            default:
                break
            }
            offset += size
        }
        return handles
    }

    func handlePTPEvent(_ eventData: Data, from camera: ICCameraDevice) {
        guard captureContinuation != nil, captureToken != nil else { return }
        guard eventData.count >= 16 else { return }

        let containerType = eventData.uint16LE(at: 4)
        let eventCode = eventData.uint16LE(at: 6)
        guard containerType == 4 else { return }

        // Canon sends RequestGetEvent (0xC101); performCanonCapture polls the
        // matching EOS GetEvent command. Standard ObjectAdded remains a fallback.
        if eventCode == 0xC101 { return }
        guard eventCode == 0x4002 else { return }

        let objectHandle = eventData.uint32LE(at: 12)
        guard objectHandle != 0, !isPTPDownloadInProgress else { return }
        isPTPDownloadInProgress = true
        status = "已拍摄，正在读取新照片…"

        Task { @MainActor [weak self, weak camera] in
            guard let self, let camera else { return }
            defer { self.isPTPDownloadInProgress = false }

            do {
                // Older EOS bodies may report ObjectAdded before the file is fully
                // committed. Retry only this new object; never enumerate the SD card.
                for attempt in 0..<8 {
                    if let image = try? await self.imageObject(handle: objectHandle, from: camera) {
                        self.latestImage = image
                        self.finishCapture(.success(image))
                        return
                    }
                    if attempt < 7 {
                        try? await Task.sleep(for: .milliseconds(350))
                    }
                }
                throw BoothCameraError.cannotReadPhoto
            } catch {
                self.finishCapture(.failure(error))
            }
        }
    }

    func imageObject(handle: UInt32, from camera: ICCameraDevice) async throws -> UIImage? {
        let infoResult = try await sendPTPCommand(.getObjectInfo, params: [handle], to: camera)
        if let infoData = infoResult.data {
            let info = ptpPayload(from: infoData)
            if info.count >= 12 {
                let format = info.uint16LE(at: 4)
                let size = info.uint32LE(at: 8)
                let jpegFormats: Set<UInt16> = [0x3800, 0x3801]
                guard jpegFormats.contains(format), size > 0 else { return nil }
            }
        }

        let objectResult = try await sendPTPCommand(.getObject, params: [handle], to: camera)
        guard let data = objectResult.data else { return nil }
        let payload = ptpPayload(from: data)
        return UIImage(data: payload) ?? UIImage(data: data)
    }

    func ptpPayload(from data: Data) -> Data {
        guard data.count >= 12 else { return data }
        let length = Int(data.uint32LE(at: 0))
        let type = data.uint16LE(at: 4)
        if length == data.count, (type == 2 || type == 3) {
            return data.subdata(in: 12..<data.count)
        }
        return data
    }
}

enum BoothCameraError: LocalizedError {
    case notConnected, busy, timedOut, disconnected, cannotReadPhoto
    case canonNotReady, canonSetupFailed(String), ptpFailed(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: "请先连接 Canon 600D"
        case .busy: "相机正在处理上一张照片"
        case .timedOut: "30 秒内没有收到照片。请关闭相机再开启，并确认使用 JPEG、SD 卡未锁定"
        case .disconnected: "拍摄时相机断开"
        case .cannotReadPhoto: "无法读取相机照片"
        case .canonNotReady: "Canon EOS 遥控尚未准备好"
        case .canonSetupFailed(let message): "无法启动 Canon EOS 遥控：\(message)"
        case .ptpFailed(let message): "相机拒绝拍摄：\(message)"
        }
    }
}

private enum PTPOperation: UInt16 {
    case getObjectInfo = 0x1008
    case getObject = 0x1009
    case canonRemoteRelease = 0x910F
    case canonSetDevicePropValueEx = 0x9110
    case canonSetRemoteMode = 0x9114
    case canonSetEventMode = 0x9115
    case canonGetEvent = 0x9116
    case canonRemoteReleaseOn = 0x9128
    case canonRemoteReleaseOff = 0x9129
    case canonGetViewFinderData = 0x9153
}

private struct PTPResult {
    let data: Data?
    let response: Data?
}

private extension Data {
    mutating func appendLittleEndian<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }

    func uint16LE(at offset: Int) -> UInt16 {
        guard offset + 2 <= count else { return 0 }
        return withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt16.self).littleEndian
        }
    }

    func uint32LE(at offset: Int) -> UInt32 {
        guard offset + 4 <= count else { return 0 }
        return withUnsafeBytes { bytes in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian
        }
    }
}
