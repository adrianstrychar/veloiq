#!/usr/bin/env bash
# VeloIQ – projekt iOS (Capacitor 6 + natywny RideEngine). Uruchom w Terminalu na Macu z katalogu repo:
#   bash mobile/setup-ios.sh
# Bezpieczne do ponownego uruchomienia. Kod web modułu Jedź jest już w repo (lib/ride, components/ride).
set -euo pipefail
cd "$(dirname "$0")/.."
say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

[[ "$(uname)" == "Darwin" ]] || { echo "Uruchom na Macu."; exit 1; }
xcodebuild -version >/dev/null 2>&1 || { echo "Brak Xcode. Zainstaluj z App Store, uruchom raz, potem: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }

say "Capacitor 6 (npm, wersje z package-lock)"
# NIE „npm i @capacitor/...@^6”: to podbija do najnowszego 6.x (6.2.3), a natywna biblioteka iOS
# (capacitor-swift-pm) ma wydania tylko do 6.2.2 → cap sync wpisuje exact 6.2.3 do Package.swift
# i Xcode nie buduje („Missing package product 'CapApp-SPM'”). Wersje trzyma package-lock.json.
npm install --no-audit --no-fund

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -n "$IP" ]]; then
  sed -i '' "s#'http://[0-9.]*:3000'#'http://$IP:3000'#" capacitor.config.ts
  ok "Adres dev w capacitor.config.ts: http://$IP:3000"
else
  warn "Nie wykryłem IP Maca – wpisz je ręcznie w capacitor.config.ts"
fi

say "Projekt iOS"
if [[ ! -d ios/App ]]; then
  if command -v pod >/dev/null; then npx cap add ios
  else warn "Brak CocoaPods – używam Swift Package Manager"; npx cap add ios --packagemanager SPM; fi
fi
APPDIR=ios/App/App
mkdir -p "$APPDIR/RideEngine"
cp mobile/ios-src/RideEngine/*.swift "$APPDIR/RideEngine/"
ok "Plugin RideEngine skopiowany"
if [[ -d public/voice/enzo ]]; then
  mkdir -p "$APPDIR/Voice" && rm -rf "$APPDIR/Voice/enzo" && cp -R public/voice/enzo "$APPDIR/Voice/enzo"
  ok "Głos Dyrektor Enzo w aplikacji ($(ls "$APPDIR/Voice/enzo" | wc -l | tr -d ' ') plików)"
fi
# nowe Xcode nie budują już dla iOS 13 – minimum 15.0
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 1[0-4]\.0;/IPHONEOS_DEPLOYMENT_TARGET = 15.0;/' ios/App/App.xcodeproj/project.pbxproj
[[ -f ios/App/CapApp-SPM/Package.swift ]] && sed -i '' 's/\.iOS(\.v1[0-4])/.iOS(.v15)/' ios/App/CapApp-SPM/Package.swift

say "Info.plist"
PL="$APPDIR/Info.plist"; PB=/usr/libexec/PlistBuddy
pset() { $PB -c "Print :$1" "$PL" >/dev/null 2>&1 && $PB -c "Set :$1 $3" "$PL" || $PB -c "Add :$1 $2 $3" "$PL"; }
pbg()  { $PB -c "Print :UIBackgroundModes" "$PL" >/dev/null 2>&1 || $PB -c "Add :UIBackgroundModes array" "$PL"
         $PB -c "Print :UIBackgroundModes" "$PL" | grep -q "^ *$1\$" || $PB -c "Add :UIBackgroundModes: string $1" "$PL"; }
pbg bluetooth-central; pbg audio; pbg location
pset NSBluetoothAlwaysUsageDescription string "VeloIQ łączy się z pomiarem mocy, pasem tętna i przyciskiem Flic na kierownicy, żeby prowadzić trening na żywo."
pset NSBluetoothPeripheralUsageDescription string "VeloIQ łączy się z pomiarem mocy, pasem tętna i przyciskiem Flic na kierownicy."
pset NSLocationWhenInUseUsageDescription string "VeloIQ zapisuje trasę treningu na zewnątrz."
pset NSMicrophoneUsageDescription string "Zadaj pytanie trenerowi Enzo głosem – przez mikrofon słuchawek lub okularów."
pset NSSpeechRecognitionUsageDescription string "VeloIQ zamienia Twoje pytanie do trenera Enzo na tekst."
pset NSLocalNetworkUsageDescription string "VeloIQ w trybie deweloperskim ładuje aplikację z komputera w tej samej sieci."
$PB -c "Print :NSAppTransportSecurity" "$PL" >/dev/null 2>&1 || $PB -c "Add :NSAppTransportSecurity dict" "$PL"
$PB -c "Print :NSAppTransportSecurity:NSAllowsLocalNetworking" "$PL" >/dev/null 2>&1 || $PB -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PL"
# Cykl życia ze scenami (UIScene) – wymagany przez nowe SDK Xcode, bez niego aplikacja się nie uruchamia.
# Scena ładuje Main.storyboard (VeloIQBridgeViewController), delegat: RideEngine/SceneDelegate.swift.
SM=":UIApplicationSceneManifest"; SC="$SM:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0"
$PB -c "Delete $SM" "$PL" 2>/dev/null || true
$PB -c "Add $SM dict" "$PL"
$PB -c "Add $SM:UIApplicationSupportsMultipleScenes bool false" "$PL"
$PB -c "Add $SM:UISceneConfigurations dict" "$PL"
$PB -c "Add $SM:UISceneConfigurations:UIWindowSceneSessionRoleApplication array" "$PL"
$PB -c "Add $SC dict" "$PL"
$PB -c "Add $SC:UISceneConfigurationName string Default" "$PL"
$PB -c "Add $SC:UISceneDelegateClassName string \$(PRODUCT_MODULE_NAME).SceneDelegate" "$PL"
$PB -c "Add $SC:UISceneStoryboardFile string Main" "$PL"
$PB -c "Delete :UIMainStoryboardFile" "$PL" 2>/dev/null || true
# pełny ekran jak w natywnej aplikacji: iPhone tylko pionowo, jasny pasek statusu na ciemnym tle
$PB -c "Delete :UISupportedInterfaceOrientations" "$PL" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PL"
$PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PL"
pset UIViewControllerBasedStatusBarAppearance bool false
pset UIStatusBarStyle string UIStatusBarStyleLightContent
ok "Tryby tła + uprawnienia + orientacja pionowa + sceny (UIScene)"

say "Main.storyboard → VeloIQBridgeViewController"
SB="$APPDIR/Base.lproj/Main.storyboard"
if ! grep -q VeloIQBridgeViewController "$SB"; then
  sed -i '' 's/customClass="CAPBridgeViewController" customModule="Capacitor"/customClass="VeloIQBridgeViewController" customModule="App" customModuleProvider="target"/' "$SB"
fi
grep -q VeloIQBridgeViewController "$SB" && ok "Storyboard ustawiony" || warn "Storyboard: podmień klasę ręcznie (Identity Inspector → VeloIQBridgeViewController, Module: App)"

say "Pliki Swift w targecie App"
if ! ruby -e "require 'xcodeproj'" 2>/dev/null; then
  warn "Instaluję gem xcodeproj (może poprosić o hasło Maca)"
  gem install --user-install xcodeproj >/dev/null 2>&1 || sudo gem install xcodeproj
fi
ruby - ios/App/App.xcodeproj <<'RUBY'
begin; require 'xcodeproj'; rescue LoadError
  Gem.paths = { 'GEM_PATH' => "#{Gem.user_dir}:#{Gem.path.join(':')}" }; require 'xcodeproj'; end
proj = Xcodeproj::Project.open(ARGV[0])
target = proj.targets.find { |t| t.name == 'App' } or abort('Brak targetu App')
app_group = proj.main_group['App'] or abort('Brak grupy App')
group = app_group['RideEngine'] || app_group.new_group('RideEngine', 'RideEngine')
Dir[File.join(File.dirname(ARGV[0]), 'App', 'RideEngine', '*.swift')].sort.each do |path|
  name = File.basename(path)
  next if group.files.any? { |f| f.path == name }
  target.source_build_phase.add_file_reference(group.new_reference(name))
  puts "  + #{name}"
end
voice = File.join(File.dirname(ARGV[0]), 'App', 'Voice')
if Dir.exist?(voice) && app_group.files.none? { |f| f.path == 'Voice' }
  ref = app_group.new_reference('Voice')
  ref.last_known_file_type = 'folder'
  target.resources_build_phase.add_file_reference(ref)
  puts '  + Voice/ (głos lektora)'
end
# Przycisk Flic na kierownicy: oficjalne SDK flic2lib (Swift Package, binarny xcframework)
flic_url = 'https://github.com/50ButtonsEach/flic2lib-ios'
flic = proj.root_object.package_references.find { |p| p.respond_to?(:repositoryURL) && p.repositoryURL.to_s.sub(/\.git$/, '') == flic_url }
unless flic
  flic = proj.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
  flic.repositoryURL = flic_url
  flic.requirement = { 'kind' => 'upToNextMajorVersion', 'minimumVersion' => '1.8.0' }
  proj.root_object.package_references << flic
  puts '  + pakiet flic2lib (przycisk Flic)'
end
unless target.package_product_dependencies.any? { |d| d.product_name == 'flic2lib' }
  dep = proj.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dep.package = flic
  dep.product_name = 'flic2lib'
  target.package_product_dependencies << dep
  bf = proj.new(Xcodeproj::Project::Object::PBXBuildFile)
  bf.product_ref = dep
  target.frameworks_build_phase.files << bf
end
target.build_configurations.each { |c| c.build_settings['SWIFT_VERSION'] = '5.0' }
proj.save
RUBY
ok "RideEngine w targecie App (Swift 5)"

say "npx cap sync ios"
npx cap sync ios

cat <<'TXT'

──────────────────────────────────────────────
Gotowe. Dalej:
 1. Nowe okno Terminala w repo:   npm run dev -- -H 0.0.0.0
 2. npx cap open ios   → target App → Signing & Capabilities → Team = Twoje Apple ID
 3. Podłącz iPhone kablem, wybierz go u góry → ▶ Run
 4. Supabase Studio → SQL → wklej supabase/migrations/021_rides.sql → Run
──────────────────────────────────────────────
TXT
