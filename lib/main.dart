import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'gatekeeper.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: tgSupabaseUrl, publishableKey: tgPublishableKey);
  runApp(const TouchGrassApp());
}

const forest = Color(0xFF183A2B);
const leaf = Color(0xFF80B978);
const paper = Color(0xFFF5F5ED);
const groundedChannel = MethodChannel('touchgrass/grounded_mode');

class TouchGrassApp extends StatelessWidget {
  const TouchGrassApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'TouchGrass',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          scaffoldBackgroundColor: paper,
          colorScheme: ColorScheme.fromSeed(seedColor: forest, surface: paper),
          fontFamily: 'Roboto',
        ),
        home: const AuthGate(child: HomeShell()),
      );
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int tab = 0;
  bool grounded = false;
  bool accessibilityEnabled = false;
  bool appBlocking = false;
  bool running = false;
  int seconds = 0;
  int totalFocusSeconds = 0;
  int grassPoints = 0;
  int focusSessions = 0;
  int currentStreak = 0;
  int sessionStartMillis = 0;
  Timer? timer;
  RealtimeChannel? grantsChannel;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadGroundedState();
    _loadAppBlockingStatus();
    _loadFocusProgress();
    _syncGatekeeperGrants();
    _cleanupGatekeeperProofs();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _loadGroundedState();
      _loadAppBlockingStatus();
      _refreshTimerDisplay();
      _syncGatekeeperGrants();
      _cleanupGatekeeperProofs();
    }
  }

  Future<void> _syncGatekeeperGrants() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    final user = tgSupabase.auth.currentUser;
    if (user == null) return;
    try {
      final rows = await tgSupabase.from('unlock_grants').select('target_key,usable_at,expires_at').eq('requester_id', user.id).gt('expires_at', DateTime.now().toUtc().toIso8601String());
      final grants = (rows as List).map((row) => <String, dynamic>{
        'targetKey': row['target_key'],
        'usableAtMillis': DateTime.parse(row['usable_at']).millisecondsSinceEpoch,
        'expiresAtMillis': DateTime.parse(row['expires_at']).millisecondsSinceEpoch,
      }).toList();
      await groundedChannel.invokeMethod<bool>('setUnlockGrants', {'grants': grants});
      grantsChannel ??= tgSupabase.channel('unlock-grants-${user.id}').onPostgresChanges(
        event: PostgresChangeEvent.all,
        schema: 'public',
        table: 'unlock_grants',
        filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'requester_id', value: user.id),
        callback: (_) => _syncGatekeeperGrants(),
      ).subscribe();
    } catch (error) {
      debugPrint('Could not sync Gatekeeper grants: $error');
    }
  }

  Future<void> _cleanupGatekeeperProofs() async {
    if (tgSupabase.auth.currentSession == null) return;
    try { await tgSupabase.functions.invoke('gatekeeper-ops', body: {'action': 'cleanup'}); }
    catch (error) { debugPrint('Could not clean expired Gatekeeper proofs: $error'); }
  }

  Future<void> _loadGroundedState() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      final active =
          await groundedChannel.invokeMethod<bool>('status') ?? false;
      if (mounted) setState(() => grounded = active);
    } on PlatformException {
      if (mounted) setState(() => grounded = false);
    }
  }

  Future<void> _loadAppBlockingStatus() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      final status = await groundedChannel.invokeMapMethod<String, bool>(
        'appBlockingStatus',
      );
      if (mounted) {
        setState(() {
          accessibilityEnabled = status?['accessibilityEnabled'] ?? false;
          appBlocking = status?['blockingEnabled'] ?? false;
        });
      }
    } on PlatformException {
      if (mounted) setState(() => accessibilityEnabled = false);
    }
  }

  Future<void> _openAppBlockingSettings() async {
    if (defaultTargetPlatform != TargetPlatform.android) {
      _snack('App blocking is currently available on Android only.');
      return;
    }
    final continueToSettings = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Allow app blocking?'),
        content: const Text(
          'TouchGrass uses Android Accessibility only to identify when Instagram, TikTok, Reddit, X, Snapchat, Facebook, or YouTube is open, then show a focus screen over it. It does not read, store, or share screen text, passwords, or page contents. You can turn this access off any time in Android Settings.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (continueToSettings != true || !mounted) return;
    try {
      await groundedChannel.invokeMethod<bool>('openAppBlockingSettings');
    } on PlatformException catch (error) {
      _snack(error.message ?? 'Could not open Android Accessibility settings.');
    }
  }

  Future<void> _setAppBlocking(bool enabled) async {
    if (running && !enabled) {
      _snack('Finish your focus session before turning off app blocking.');
      return;
    }
    try {
      final active = await groundedChannel.invokeMethod<bool>(
            'setAppBlockingEnabled',
            enabled,
          ) ??
          false;
      if (mounted) setState(() => appBlocking = active);
    } on PlatformException catch (error) {
      if (mounted) _snack(error.message ?? 'Could not change app blocking.');
    }
  }

  Future<void> _setGroundedMode(bool enable) async {
    if (running && !enable) {
      _snack('Finish your focus session before turning off Grounded Mode.');
      return;
    }
    if (defaultTargetPlatform != TargetPlatform.android) {
      _snack('Grounded Mode is currently available on Android only.');
      return;
    }
    try {
      final active =
          await groundedChannel.invokeMethod<bool>(enable ? 'start' : 'stop') ??
              false;
      if (mounted) setState(() => grounded = active);
      if (mounted && active != enable) {
        _snack('Grounded Mode could not be changed.');
      }
    } on PlatformException catch (error) {
      if (mounted) _snack(error.message ?? 'Could not change Grounded Mode.');
    } on MissingPluginException {
      if (mounted) {
        _snack('Android Grounded Mode is unavailable in this build.');
      }
    }
  }

  Future<void> _loadFocusProgress() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      final progress = await groundedChannel.invokeMapMethod<String, dynamic>(
        'focusProgress',
      );
      if (progress != null && mounted) _applyFocusProgress(progress);
    } on PlatformException {
      if (mounted) _snack('Could not load your saved focus progress.');
    }
  }

  void _applyFocusProgress(Map<String, dynamic> progress) {
    final startedAt = (progress['sessionStartMillis'] as num?)?.toInt() ?? 0;
    final active = progress['sessionActive'] == true;
    timer?.cancel();
    setState(() {
      totalFocusSeconds = (progress['totalFocusSeconds'] as num?)?.toInt() ?? 0;
      grassPoints = (progress['grassPoints'] as num?)?.toInt() ?? 0;
      focusSessions = (progress['sessions'] as num?)?.toInt() ?? 0;
      currentStreak = (progress['currentStreak'] as num?)?.toInt() ?? 0;
      sessionStartMillis = active ? startedAt : 0;
      running = active;
      seconds = active ? _elapsedSince(startedAt) : 0;
    });
    if (active) _startTicker();
  }

  void _startTicker() {
    timer?.cancel();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && running) _refreshTimerDisplay();
    });
  }

  void _refreshTimerDisplay() {
    if (!running || sessionStartMillis == 0) return;
    final elapsed = _elapsedSince(sessionStartMillis);
    if (elapsed != seconds && mounted) setState(() => seconds = elapsed);
  }

  int _elapsedSince(int startedAt) =>
      ((DateTime.now().millisecondsSinceEpoch - startedAt) / 1000)
          .floor()
          .clamp(0, 24 * 60 * 60)
          .toInt();

  Future<void> toggleFocus() async {
    if (running) {
      timer?.cancel();
      if (defaultTargetPlatform == TargetPlatform.android) {
        try {
          final progress =
              await groundedChannel.invokeMapMethod<String, dynamic>(
            'stopFocus',
          );
          if (progress != null && mounted) _applyFocusProgress(progress);
        } on PlatformException catch (error) {
          if (mounted) _snack(error.message ?? 'Could not save this session.');
        }
      } else {
        if (!mounted) return;
        setState(() {
          totalFocusSeconds += seconds;
          grassPoints = (totalFocusSeconds ~/ 3600) * 100;
          focusSessions++;
          running = false;
          sessionStartMillis = 0;
          seconds = 0;
        });
      }
      return;
    }

    if (defaultTargetPlatform == TargetPlatform.android &&
        !grounded &&
        !appBlocking) {
      _snack(
          'Turn on Grounded Mode or app blocking before starting a scored session.');
      return;
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      try {
        final progress = await groundedChannel.invokeMapMethod<String, dynamic>(
          'startFocus',
        );
        if (progress != null && mounted) _applyFocusProgress(progress);
      } on PlatformException catch (error) {
        if (mounted) {
          _snack(error.message ?? 'Could not start the focus session.');
        }
      }
    } else {
      final startedAt = DateTime.now().millisecondsSinceEpoch;
      setState(() {
        running = true;
        sessionStartMillis = startedAt;
        seconds = 0;
      });
      _startTicker();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    if (grantsChannel != null) tgSupabase.removeChannel(grantsChannel!);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          backgroundColor: paper,
          title: const Row(
            children: [
              Icon(Icons.spa_rounded, color: forest, size: 25),
              SizedBox(width: 8),
              Text(
                'touchgrass',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: forest,
                  letterSpacing: -0.5,
                ),
              ),
            ],
          ),
          actions: [
            Container(
              margin: const EdgeInsets.only(right: 18),
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
              decoration: BoxDecoration(
                color: const Color(0xFFE7EEE2),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.local_fire_department_rounded,
                    size: 17,
                    color: Color(0xFFE58A42),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    currentStreak == 0
                        ? 'Start your streak'
                        : '$currentStreak day streak',
                    style: const TextStyle(
                      color: forest,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: IndexedStack(
            index: tab,
            children: [_today(), _lawn(), _squad(), _you()],
          ),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) => setState(() => tab = i),
          backgroundColor: Colors.white,
          indicatorColor: const Color(0xFFE3EDDF),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.grid_view_rounded),
              label: 'Today',
            ),
            NavigationDestination(
              icon: Icon(Icons.grass_rounded),
              label: 'The Lawn',
            ),
            NavigationDestination(
                icon: Icon(Icons.groups_rounded), label: 'Squad'),
            NavigationDestination(
                icon: Icon(Icons.person_rounded), label: 'You'),
          ],
        ),
      );

  Widget _today() => ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          Text(
            _todayLabel(),
            style: const TextStyle(
              color: Color(0xFF79877B),
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.3,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Make today\nyour own.',
            style: TextStyle(
              color: forest,
              fontWeight: FontWeight.w800,
              fontSize: 34,
              height: 1.06,
              letterSpacing: -1.3,
            ),
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: forest,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'YOUR FOCUS SESSION',
                      style: TextStyle(
                        color: Color(0xFFB9D1B4),
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2B503D),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.circle,
                            color: (grounded || appBlocking)
                                ? leaf
                                : Colors.orangeAccent,
                            size: 7,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            (grounded || appBlocking) ? 'GROUNDED' : 'OFF',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              letterSpacing: .8,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 13),
                Text(
                  _clock(seconds),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 48,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                  ),
                ),
                const Text(
                  'Stay present. Your focus time is saved on this device.',
                  style: TextStyle(color: Color(0xFFC2D2C4), fontSize: 13),
                ),
                const SizedBox(height: 18),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: toggleFocus,
                    icon: Icon(
                      running ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    ),
                    label: Text(running
                        ? 'Finish focus session'
                        : 'Start focus session'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFD9EDC9),
                      foregroundColor: forest,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      textStyle: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _stat('$grassPoints', 'GRASS POINTS', Icons.eco_rounded),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _stat(
                    _rankName(), 'CURRENT RANK', Icons.emoji_events_rounded),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _sectionTitle('Your people', 'See squad'),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _card(),
            child: Row(
              children: [
                _avatar('G', const Color(0xFFE9B99A)),
                const SizedBox(width: 8),
                _avatar('J', const Color(0xFFC6D4A9)),
                const SizedBox(width: 8),
                _avatar('A', const Color(0xFFD9B6D6)),
                const SizedBox(width: 13),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Maya, Jay & Alex',
                        style: TextStyle(
                          color: forest,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'All focused right now',
                        style:
                            TextStyle(color: Color(0xFF79877B), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: 15,
                  color: forest,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _sectionTitle('Grounded mode', null),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: _card(),
            child: Row(
              children: [
                const Icon(Icons.shield_moon_rounded, color: forest),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        grounded
                            ? 'DNS filtering is active'
                            : 'Grounded Mode is off',
                        style: const TextStyle(
                          color: forest,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const Text(
                        'Instagram · TikTok · X · Reddit',
                        style:
                            TextStyle(color: Color(0xFF79877B), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Switch(
                  value: grounded,
                  activeThumbColor: leaf,
                  onChanged: _setGroundedMode,
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Standard DNS only; encrypted DNS, direct IP access and app launches may bypass it. Other DNS goes to Cloudflare (1.1.1.1).',
            style: TextStyle(color: Color(0xFF79877B), fontSize: 10),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _requestUnlock,
              child: const Text('Ask your gatekeeper for a pass'),
            ),
          ),
          const MyGatekeeperStatus(),
        ],
      );

  Widget _lawn() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'THE LAWN',
            style: TextStyle(
              color: Color(0xFF79877B),
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.3,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            'Little wins,\ngrowing together.',
            style: TextStyle(
              color: forest,
              fontWeight: FontWeight.w800,
              fontSize: 32,
              height: 1.08,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () =>
                  _snack('Camera posting will be connected in a later build.'),
              icon: const Icon(Icons.add_a_photo_rounded),
              label: const Text('Share today’s moment'),
              style: FilledButton.styleFrom(
                backgroundColor: forest,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          const SizedBox(height: 12),
          _post(
            'Maya Chen',
            '🌿 5 km trail run',
            '20 min ago · GPS check-in',
            'M',
            const Color(0xFFE9B99A),
            '1.5×',
          ),
          _post(
            'Jay Patel',
            '📚 Deep work at the library',
            '1 hr ago · Focus session',
            'J',
            const Color(0xFFC6D4A9),
            '1.2×',
          ),
          _post(
            'Alex Rivera',
            '☀️ Morning walk before class',
            '3 hrs ago · 2.4 km',
            'A',
            const Color(0xFFD9B6D6),
            '1.2×',
          ),
          const Padding(
            padding: EdgeInsets.all(14),
            child: Text(
              'You’re all caught up for today. See you tomorrow 🌱',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF79877B), fontSize: 12),
            ),
          ),
        ],
      );

  Widget _post(
    String name,
    String title,
    String meta,
    String initial,
    Color color,
    String boost,
  ) =>
      Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(16),
        decoration: _card(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _avatar(initial, color),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    name,
                    style: const TextStyle(
                      color: forest,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text(
                  boost,
                  style: const TextStyle(
                    color: Color(0xFF648F56),
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              height: 126,
              width: double.infinity,
              decoration: BoxDecoration(
                color: const Color(0xFFE9EEE2),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Center(
                child: Icon(
                  Icons.landscape_rounded,
                  size: 56,
                  color: forest.withValues(alpha: .55),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                color: forest,
                fontWeight: FontWeight.w800,
                fontSize: 15,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              meta,
              style: const TextStyle(color: Color(0xFF79877B), fontSize: 11),
            ),
            const Divider(height: 22),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _reaction('✋', 'High five'),
                _reaction('🔥', 'Flame'),
                _reaction('⚡', 'Hype'),
              ],
            ),
          ],
        ),
      );

  Widget _reaction(String icon, String label) => InkWell(
        onTap: () => _snack('$label sent!'),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(5),
          child: Row(
            children: [
              Text(icon),
              const SizedBox(width: 5),
              Text(
                label,
                style: const TextStyle(
                  color: forest,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      );

  Widget _squad() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'YOUR SQUAD',
            style: TextStyle(
              color: Color(0xFF79877B),
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.3,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            'Better, together.',
            style: TextStyle(
              color: forest,
              fontWeight: FontWeight.w800,
              fontSize: 32,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: forest,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'FOCUS RAID',
                  style: TextStyle(
                    color: Color(0xFFB9D1B4),
                    fontSize: 10,
                    letterSpacing: 1.2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Study sprint',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Maya, Jay and Alex are in. Join for 45 minutes.',
                  style: TextStyle(color: Color(0xFFC2D2C4), fontSize: 12),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => _snack('You joined the Focus Raid!'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFD9EDC9),
                      foregroundColor: forest,
                    ),
                    child: const Text('Join Focus Raid'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          _sectionTitle('Wall of fame', null),
          const SizedBox(height: 9),
          _rank(
            1,
            'Maya Chen',
            '12 day streak',
            'Titan',
            'M',
            const Color(0xFFE9B99A),
          ),
          _rank(2, 'You', '7 day streak', 'Sprout', 'O', leaf),
          _rank(
            3,
            'Jay Patel',
            '5 day streak',
            'Sprout',
            'J',
            const Color(0xFFC6D4A9),
          ),
          const SizedBox(height: 18),
          _sectionTitle('Gatekeeper', null),
          const SizedBox(height: 9),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _card(),
            child: Row(
              children: [
                _avatar('M', const Color(0xFFE9B99A)),
                const SizedBox(width: 11),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Gatekeeper pairing',
                        style: TextStyle(
                          color: forest,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Connect a trusted person to review pass requests',
                        style:
                            TextStyle(color: Color(0xFF79877B), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GatekeeperHub())),
                  child: const Text('Manage'),
                ),
              ],
            ),
          ),
        ],
      );

  Widget _you() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'YOUR GROWTH',
            style: TextStyle(
              color: Color(0xFF79877B),
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.3,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            'You’re putting\nin the work.',
            style: TextStyle(
              color: forest,
              fontWeight: FontWeight.w800,
              fontSize: 32,
              height: 1.08,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: _card(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '🌿  ${_rankName().toUpperCase()}',
                  style: const TextStyle(
                    color: forest,
                    fontWeight: FontWeight.w800,
                    letterSpacing: .8,
                  ),
                ),
                const SizedBox(height: 15),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '$grassPoints GP',
                      style: const TextStyle(
                        color: forest,
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      _nextRankName() == null
                          ? 'Top rank'
                          : 'Next: ${_nextRankName()}',
                      style: const TextStyle(
                          color: Color(0xFF79877B), fontSize: 11),
                    ),
                  ],
                ),
                const SizedBox(height: 11),
                ClipRRect(
                  borderRadius: BorderRadius.circular(9),
                  child: LinearProgressIndicator(
                    value: _rankProgress(),
                    minHeight: 9,
                    backgroundColor: const Color(0xFFE8EDE4),
                    color: leaf,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  _nextRankName() == null
                      ? 'Focus Legend reached'
                      : '${(_rankThreshold() - grassPoints).clamp(0, 500)} points to your next rank',
                  style:
                      const TextStyle(color: Color(0xFF79877B), fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(height: 15),
          Row(
            children: [
              Expanded(
                child: _stat(_formatFocus(totalFocusSeconds), 'FOCUS TOTAL',
                    Icons.timer_rounded),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _stat(
                  currentStreak == 1 ? '1 day' : '$currentStreak days',
                  'CURRENT STREAK',
                  Icons.local_fire_department_rounded,
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          _sectionTitle('Your habits', null),
          const SizedBox(height: 9),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _card(),
            child: Column(
              children: [
                _habit(
                  'Focus sessions',
                  '$focusSessions sessions · ${_formatFocus(totalFocusSeconds)} total',
                  Icons.center_focus_strong_rounded,
                ),
                const Divider(height: 22),
                _habit(
                  'Outdoors',
                  '3 walks · 8.2 km',
                  Icons.directions_walk_rounded,
                ),
                const Divider(height: 22),
                _habit('Reading', '4 days this week', Icons.menu_book_rounded),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _card(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.phonelink_lock_rounded, color: forest),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Block social apps',
                            style: TextStyle(
                              color: forest,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            accessibilityEnabled
                                ? (appBlocking
                                    ? 'App blocking is on'
                                    : 'Permission is ready')
                                : 'Set up Android Accessibility access',
                            style: const TextStyle(
                              color: Color(0xFF79877B),
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (accessibilityEnabled)
                      Switch(
                        value: appBlocking,
                        activeThumbColor: leaf,
                        onChanged: _setAppBlocking,
                      )
                    else
                      TextButton(
                        onPressed: _openAppBlockingSettings,
                        child: const Text('Set up'),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                const Text(
                  'Covers Instagram, TikTok, Reddit, X, Snapchat, Facebook, and YouTube. TouchGrass checks app names only; it does not read screen content.',
                  style: TextStyle(
                    color: Color(0xFF79877B),
                    fontSize: 10,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      );

  Widget _habit(String title, String detail, IconData icon) => Row(
        children: [
          Icon(icon, color: leaf),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: forest,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  detail,
                  style:
                      const TextStyle(color: Color(0xFF79877B), fontSize: 11),
                ),
              ],
            ),
          ),
          const Icon(Icons.check_circle_rounded, color: leaf, size: 19),
        ],
      );
  Widget _rank(
    int place,
    String name,
    String streak,
    String rank,
    String initial,
    Color color,
  ) =>
      Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: _card(),
        child: Row(
          children: [
            Text(
              '$place',
              style: const TextStyle(
                color: Color(0xFF79877B),
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(width: 12),
            _avatar(initial, color),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: const TextStyle(
                      color: forest,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    streak,
                    style:
                        const TextStyle(color: Color(0xFF79877B), fontSize: 11),
                  ),
                ],
              ),
            ),
            Text(
              rank,
              style: const TextStyle(
                color: forest,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );
  Widget _stat(String value, String label, IconData icon) => Container(
        padding: const EdgeInsets.all(16),
        decoration: _card(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: leaf, size: 19),
            const SizedBox(height: 9),
            Text(
              value,
              style: const TextStyle(
                color: forest,
                fontSize: 21,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFF79877B),
                fontSize: 9,
                fontWeight: FontWeight.w800,
                letterSpacing: .6,
              ),
            ),
          ],
        ),
      );
  Widget _avatar(String initial, Color color) => CircleAvatar(
        radius: 19,
        backgroundColor: color,
        child: Text(
          initial,
          style: const TextStyle(color: forest, fontWeight: FontWeight.w800),
        ),
      );
  Widget _sectionTitle(String title, String? action) => Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: forest,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
          if (action != null)
            Text(
              action,
              style: const TextStyle(
                color: Color(0xFF688F5C),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
        ],
      );
  BoxDecoration _card() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE8EBE3)),
      );
  String _todayLabel() {
    final today = DateTime.now();
    const weekdays = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY'
    ];
    const months = [
      'JANUARY',
      'FEBRUARY',
      'MARCH',
      'APRIL',
      'MAY',
      'JUNE',
      'JULY',
      'AUGUST',
      'SEPTEMBER',
      'OCTOBER',
      'NOVEMBER',
      'DECEMBER'
    ];
    return '${weekdays[today.weekday - 1]}, ${months[today.month - 1]} ${today.day}';
  }

  String _rankName() {
    if (grassPoints < 500) return 'Seedling';
    if (grassPoints < 1000) return 'Sprout';
    if (grassPoints < 1500) return 'Lawn Care';
    if (grassPoints < 2000) return 'TouchGrass Titan';
    return 'Focus Legend';
  }

  String? _nextRankName() {
    if (grassPoints < 500) return 'Sprout';
    if (grassPoints < 1000) return 'Lawn Care';
    if (grassPoints < 1500) return 'TouchGrass Titan';
    if (grassPoints < 2000) return 'Focus Legend';
    return null;
  }

  int _rankThreshold() {
    if (grassPoints < 500) return 500;
    if (grassPoints < 1000) return 1000;
    if (grassPoints < 1500) return 1500;
    return 2000;
  }

  double _rankProgress() {
    final lowerBound = grassPoints < 500
        ? 0
        : grassPoints < 1000
            ? 500
            : grassPoints < 1500
                ? 1000
                : grassPoints < 2000
                    ? 1500
                    : 2000;
    final upperBound = _rankThreshold();
    if (upperBound == lowerBound) return 1;
    return ((grassPoints - lowerBound) / (upperBound - lowerBound))
        .clamp(0.0, 1.0)
        .toDouble();
  }

  String _formatFocus(int focusSeconds) {
    final hours = focusSeconds / 3600;
    if (hours >= 1) return '${hours.toStringAsFixed(1)}h';
    final minutes = focusSeconds ~/ 60;
    return '${minutes}m';
  }

  String _clock(int s) =>
      '${(s ~/ 3600).toString().padLeft(2, '0')}:${((s ~/ 60) % 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
  Future<void> _requestUnlock() async {
    final requested = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const UnlockRequestScreen()),
    );
    if (requested == true && mounted) _snack('Your request is with your Gatekeeper.');
  }

  void _snack(String message) => ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
        ),
      );
}
