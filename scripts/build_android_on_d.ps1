param(
    [string]$BuildRoot = 'D:\Vaani-Setu-Validation',
    [string]$FlutterSdkSource = '',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
if ([IO.Path]::GetPathRoot($BuildRoot) -ne 'D:\') {
    throw 'Choose a build directory on D:.'
}
New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null

function Copy-Tree([string]$Source, [string]$Destination, [string[]]$Exclude = @()) {
    if ([IO.Path]::GetFullPath($Source).TrimEnd('\') -eq [IO.Path]::GetFullPath($Destination).TrimEnd('\')) { return }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $copyArgs = @($Source, $Destination, '/E', '/XJ', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($Exclude.Count) { $copyArgs += @('/XD') + $Exclude }
    & robocopy @copyArgs | Out-Host
    if ($LASTEXITCODE -lt 0 -or $LASTEXITCODE -ge 8) { throw "Copy failed: $Source" }
}

if (!$FlutterSdkSource) {
    $FlutterSdkSource = Split-Path (Split-Path (Get-Command flutter).Source -Parent) -Parent
}
$flutterSdk = Join-Path $BuildRoot 'flutter-sdk'
$pubCache = Join-Path $BuildRoot 'pub-cache'
$gradleCache = Join-Path $BuildRoot 'gradle'
$taskTemp = Join-Path $BuildRoot 'temp'
$androidUser = Join-Path $BuildRoot 'android-user'

Write-Host 'Preparing Flutter SDK on D: (excluding generated SDK build caches)...'
if (!(Test-Path (Join-Path $flutterSdk '.vaani-sdk-ready'))) {
    Copy-Tree $FlutterSdkSource $flutterSdk @('.gradle', '.dart_tool', 'build', '.idea', 'agent-artifacts')
    New-Item -ItemType File -Path (Join-Path $flutterSdk '.vaani-sdk-ready') -Force | Out-Null
}
$lockHash = (Get-FileHash (Join-Path $repoRoot 'pubspec.lock') -Algorithm SHA256).Hash
$cacheStamp = Join-Path $pubCache '.vaani-lock-hash'
if (!(Test-Path $cacheStamp) -or ([IO.File]::ReadAllText($cacheStamp) -ne $lockHash)) {
    Write-Host 'Copying this app''s cached Dart dependencies to D:...'
    $sourcePubCache = if ($env:PUB_CACHE) { $env:PUB_CACHE } else { Join-Path $env:LOCALAPPDATA 'Pub\Cache' }
    $packageConfig = Join-Path $repoRoot '.dart_tool\package_config.json'
    if (Test-Path $packageConfig) {
        $packages = (Get-Content -LiteralPath $packageConfig -Raw | ConvertFrom-Json).packages
        foreach ($package in $packages) {
            $uri = [Uri]$package.rootUri
            if (!$uri.IsAbsoluteUri -or !$uri.IsFile) { continue }
            $source = $uri.LocalPath.TrimEnd('\', '/')
            if ($source.StartsWith($sourcePubCache + '\', [StringComparison]::OrdinalIgnoreCase)) {
                $relative = $source.Substring($sourcePubCache.Length + 1)
                Copy-Tree $source (Join-Path $pubCache $relative) @('.gradle', 'build')
            }
        }
        foreach ($metadata in @('hosted\pub.dev\.cache', 'hosted-hashes')) {
            $source = Join-Path $sourcePubCache $metadata
            if (Test-Path $source) { Copy-Tree $source (Join-Path $pubCache $metadata) }
        }
    } else {
        Copy-Tree $sourcePubCache $pubCache @('.gradle', 'build')
    }
    [IO.File]::WriteAllText($cacheStamp, $lockHash)
}
foreach ($directory in @($taskTemp, $androidUser, $gradleCache)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
# Preserve the existing debug signing identity, when one is available.
$existingDebugKey = Join-Path $env:USERPROFILE '.android\debug.keystore'
if ((Test-Path $existingDebugKey) -and !(Test-Path (Join-Path $androidUser 'debug.keystore'))) {
    Copy-Item -LiteralPath $existingDebugKey -Destination $androidUser
}

# A fresh source snapshot includes uncommitted edits without stale deleted files.
$stage = Join-Path $BuildRoot ('app-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($directory in @('lib', 'android', 'test')) {
    Copy-Tree (Join-Path $repoRoot $directory) (Join-Path $stage $directory) @('build', '.gradle', '.cxx')
}
foreach ($file in @('pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stage
}

$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$env:PUB_CACHE = $pubCache
$env:GRADLE_USER_HOME = $gradleCache
$env:ANDROID_USER_HOME = $androidUser
$env:ANDROID_EMULATOR_HOME = $androidUser
$env:FLUTTER_ROOT = $flutterSdk
$env:FLUTTER_SUPPRESS_ANALYTICS = 'true'
$env:CI = 'true'
if (!$env:JAVA_HOME) {
    foreach ($candidate in @("$env:ProgramFiles\Android\Android Studio1\jbr", "$env:ProgramFiles\Android\Android Studio\jbr")) {
        if (Test-Path (Join-Path $candidate 'bin\java.exe')) { $env:JAVA_HOME = $candidate; break }
    }
}

# Only this disposable build copy gets the D: SDK path and memory limits.
$properties = Join-Path $stage 'android\local.properties'
$text = [IO.File]::ReadAllText($properties)
$text = [regex]::Replace($text, '(?m)^flutter\.sdk=.*$', 'flutter.sdk=' + $flutterSdk.Replace('\', '/'))
[IO.File]::WriteAllText($properties, $text)
$gradleProperties = Join-Path $stage 'android\gradle.properties'
$text = [IO.File]::ReadAllText($gradleProperties)
$text = [regex]::Replace($text, '(?m)^org\.gradle\.jvmargs=.*$', 'org.gradle.jvmargs=-Xmx2G -XX:MaxMetaspaceSize=1G -Djava.io.tmpdir=' + $taskTemp.Replace('\', '/'))
$text += "`norg.gradle.workers.max=2`nkotlin.daemon.jvmargs=-Xmx1G`n"
[IO.File]::WriteAllText($gradleProperties, $text)

$flutter = Join-Path $flutterSdk 'bin\flutter.bat'
Push-Location $stage
try {
    Write-Host "Building source snapshot: $stage"
    $pubArgs = @('pub', 'get')
    if ($Offline) { $pubArgs += '--offline' }
    & $flutter @pubArgs
    if ($LASTEXITCODE) { throw 'Flutter package resolution failed.' }
    if ($Offline) {
        Push-Location android
        try {
            & .\gradlew.bat --offline --max-workers=2 '-Ptarget=lib/main.dart' '-Ptarget-platform=android-arm,android-arm64,android-x64' assembleDebug
            if ($LASTEXITCODE) { throw 'Android build failed.' }
        } finally { Pop-Location }
    } else {
        & $flutter build apk --debug --no-pub
        if ($LASTEXITCODE) { throw 'Android build failed.' }
    }
    $apk = Join-Path $stage 'build\app\outputs\flutter-apk\app-debug.apk'
    if (!(Test-Path $apk)) { throw 'Build did not produce an APK.' }
    $deliverable = Join-Path $BuildRoot 'Vaani-Setu-messaging-debug.apk'
    Copy-Item -LiteralPath $apk -Destination $deliverable -Force
    Write-Host "APK ready: $deliverable"
} finally { Pop-Location }
