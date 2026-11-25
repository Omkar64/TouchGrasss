import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

const tgSupabaseUrl = 'https://ymhqwucexknvvmxwtvgh.supabase.co';
const tgPublishableKey = 'sb_publishable_zY-wY2WIQAf88suVMaOxCQ_D7Xw5vJz';
final tgSupabase = Supabase.instance.client;

class AuthGate extends StatelessWidget {
  const AuthGate({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => StreamBuilder<AuthState>(
        stream: tgSupabase.auth.onAuthStateChange,
        builder: (context, snapshot) => tgSupabase.auth.currentSession == null
            ? const EmailPasswordScreen()
            : child,
      );
}

class EmailPasswordScreen extends StatefulWidget {
  const EmailPasswordScreen({super.key});
  @override
  State<EmailPasswordScreen> createState() => _EmailPasswordScreenState();
}

class _EmailPasswordScreenState extends State<EmailPasswordScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool createAccount = false, busy = false, obscurePassword = true;
  String? error, notice;

  Future<void> submit() async {
    setState(() { busy = true; error = null; notice = null; });
    try {
      final address = email.text.trim();
      if (createAccount) {
        if (password.text.length < 8) {
          throw const AuthException('Use a password with at least 8 characters.');
        }
        final response = await tgSupabase.auth.signUp(
          email: address,
          password: password.text,
          data: {'name': address.split('@').first},
        );
        if (response.session == null && mounted) {
          setState(() => notice = 'Account created. Email confirmation is still enabled in Supabase.');
        }
      } else {
        await tgSupabase.auth.signInWithPassword(email: address, password: password.text);
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('AuthException: ', ''));
    }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  void dispose() { email.dispose(); password.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F5ED),
    body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(28), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Icon(Icons.spa_rounded, size: 64, color: Color(0xFF183A2B)),
      const SizedBox(height: 16), const Text('TouchGrass', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: Color(0xFF183A2B))),
      const SizedBox(height: 8), Text(createAccount ? 'Create an account to connect with your Gatekeeper.' : 'Sign in to connect with your Gatekeeper.', textAlign: TextAlign.center),
      const SizedBox(height: 24), TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder())),
      const SizedBox(height: 12), TextField(controller: password, obscureText: obscurePassword, decoration: InputDecoration(labelText: 'Password', border: const OutlineInputBorder(), suffixIcon: IconButton(onPressed: () => setState(() => obscurePassword = !obscurePassword), icon: Icon(obscurePassword ? Icons.visibility : Icons.visibility_off)))),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: const TextStyle(color: Colors.red))),
      if (notice != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(notice!, style: const TextStyle(color: Color(0xFF183A2B)))),
      const SizedBox(height: 14), FilledButton(onPressed: busy ? null : submit, child: Text(busy ? 'Please wait…' : createAccount ? 'Create account' : 'Log in')),
      TextButton(onPressed: busy ? null : () => setState(() { createAccount = !createAccount; error = null; notice = null; }), child: Text(createAccount ? 'I already have an account' : 'Create an account')),
    ])))));
}

class GatekeeperHub extends StatefulWidget {
  const GatekeeperHub({super.key});
  @override
  State<GatekeeperHub> createState() => _GatekeeperHubState();
}

class _GatekeeperHubState extends State<GatekeeperHub> {
  final inviteCode = TextEditingController();
  String? generatedCode, message;
  bool busy = false;
  Future<void> invoke(String action, [Map<String, dynamic> data = const {}]) async {
    setState(() { busy = true; message = null; });
    try {
      final result = await tgSupabase.functions.invoke('gatekeeper-ops', body: {'action': action, ...data});
      if (result.status >= 400 || result.data is Map && result.data['error'] != null) throw Exception((result.data as Map)['error'] ?? 'Request failed');
      if (action == 'create-invite') generatedCode = result.data['code'] as String;
      message = action == 'redeem-invite' ? 'Gatekeeper pairing accepted.' : action == 'review-unlock-request' ? 'Decision sent.' : 'Done.';
    } catch (e) { message = e.toString().replaceFirst('Exception: ', ''); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Gatekeeper'), actions: [IconButton(onPressed: () => tgSupabase.auth.signOut(), icon: const Icon(Icons.logout))]),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Pairing is one-way: the person who creates the code becomes the requester; the person entering it becomes their Gatekeeper.'),
      const SizedBox(height: 16), Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [const Text('I need a Gatekeeper', style: TextStyle(fontWeight: FontWeight.bold)), const SizedBox(height: 8), const Text('Create a code and share it privately. It expires in 24 hours.'), const SizedBox(height: 10), FilledButton(onPressed: busy ? null : () => invoke('create-invite'), child: const Text('Create invite code')), if (generatedCode != null) SelectableText(generatedCode!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 4))]))),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [const Text('I am someone’s Gatekeeper', style: TextStyle(fontWeight: FontWeight.bold)), TextField(controller: inviteCode, textCapitalization: TextCapitalization.characters, maxLength: 10, decoration: const InputDecoration(labelText: 'Invite code')), FilledButton(onPressed: busy ? null : () => invoke('redeem-invite', {'code': inviteCode.text}), child: const Text('Accept invite'))]))),
      if (message != null) Padding(padding: const EdgeInsets.all(8), child: Text(message!)),
      const SizedBox(height: 12), const Text('Inbox', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
      const _GatekeeperInbox(),
    ]),
  );
}

class _GatekeeperInbox extends StatefulWidget { const _GatekeeperInbox(); @override State<_GatekeeperInbox> createState()=>_GatekeeperInboxState(); }
class _GatekeeperInboxState extends State<_GatekeeperInbox> {
  late Stream<List<Map<String,dynamic>>> stream;
  final proofPlayer=AudioPlayer();
  @override void initState(){super.initState(); stream=tgSupabase.from('unlock_requests').stream(primaryKey:['id']).order('created_at',ascending:false);}
  Future<void> review(String id,int? minutes) async { try { await tgSupabase.functions.invoke('gatekeeper-ops',body:{'action':'review-unlock-request','requestId':id,'minutes':minutes}); } catch(_) {} }
  Future<void> playProof(String path) async { try { final bytes=await tgSupabase.storage.from('unlock-proofs').download(path); await proofPlayer.play(BytesSource(bytes)); } catch(e) { if(mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Could not open proof: $e'))); } }
  @override Widget build(BuildContext context)=>StreamBuilder(stream:stream,builder:(context,snapshot){
    final rows=(snapshot.data??[]).where((r)=>r['status']=='pending').toList();
    if(snapshot.hasError) return const ListTile(title:Text('Inbox unavailable. Check your connection.'));
    if(rows.isEmpty) return const ListTile(title:Text('No pending requests.'));
    return Column(children: rows.map((r)=>Card(child:Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('${r['target_key']} · ${r['proof_type']} proof',style:const TextStyle(fontWeight:FontWeight.bold)),Text('Request expires ${r['expires_at']}'),TextButton.icon(onPressed:()=>playProof(r['proof_path']),icon:const Icon(Icons.play_arrow),label:const Text('Listen to five-second proof')),Wrap(spacing:5,children:[for(final m in [5,15,30]) TextButton(onPressed:()=>review(r['id'],m),child:Text('Approve $m min')),TextButton(onPressed:()=>review(r['id'],null),child:const Text('Reject'))])])))).toList());
  });
}

class UnlockRequestScreen extends StatefulWidget { const UnlockRequestScreen({super.key}); @override State<UnlockRequestScreen> createState()=>_UnlockRequestScreenState(); }
class _UnlockRequestScreenState extends State<UnlockRequestScreen>{
  static const targets={'Instagram':'instagram','TikTok':'tiktok','X':'x','Reddit':'reddit','Snapchat':'snapchat','Facebook':'facebook','YouTube':'youtube'};
  String target='instagram'; bool recording=false,busy=false; String? error;
  final recorder=AudioRecorder();
  Future<void> recordAndSend() async {
    setState(()=>error=null);
    try{
      if(!await recorder.hasPermission()) throw Exception('Microphone permission is required to record a live voice proof.');
      final id=const Uuid().v4(); final dir=await getTemporaryDirectory(); final path='${dir.path}/$id.m4a';
      await recorder.start(const RecordConfig(encoder:AudioEncoder.aacLc,sampleRate:44100,bitRate:96000),path:path);
      setState(()=>recording=true); await Future.delayed(const Duration(seconds:5));
      final stopped=await recorder.stop(); setState(()=>recording=false); if(stopped==null) throw Exception('Recording did not complete.');
      setState(()=>busy=true); final uid=tgSupabase.auth.currentUser!.id; final storagePath='$uid/$id.m4a';
      await tgSupabase.storage.from('unlock-proofs').upload(storagePath,File(stopped),fileOptions:const FileOptions(contentType:'audio/mp4'));
      final result=await tgSupabase.functions.invoke('gatekeeper-ops',body:{'action':'create-unlock-request','requestId':id,'targetKey':target,'proofType':'voice','proofPath':storagePath});
      if(result.status>=400) throw Exception(result.data['error']??'Could not submit request');
      if(mounted) Navigator.pop(context,true);
    }catch(e){if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));}
    finally{if(mounted)setState((){recording=false;busy=false;});}
  }
  @override void dispose(){recorder.dispose();super.dispose();}
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Ask your Gatekeeper')),body:Padding(padding:const EdgeInsets.all(20),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[const Text('Choose one blocked app and record a live five-second voice note explaining why you need a short pass.'),const SizedBox(height:18),DropdownButtonFormField<String>(initialValue:target,decoration:const InputDecoration(labelText:'Blocked app'),items:targets.entries.map((e)=>DropdownMenuItem(value:e.value,child:Text(e.key))).toList(),onChanged:(v)=>setState(()=>target=v??target)),const Spacer(),if(error!=null)Text(error!,style:const TextStyle(color:Colors.red)),FilledButton.icon(onPressed:busy||recording?null:recordAndSend,icon:Icon(recording?Icons.mic:Icons.mic_none),label:Text(recording?'Recording five-second proof…':busy?'Sending…':'Record proof and send')),const SizedBox(height:20)])));
}

class MyGatekeeperStatus extends StatefulWidget { const MyGatekeeperStatus({super.key}); @override State<MyGatekeeperStatus> createState()=>_MyGatekeeperStatusState(); }
class _MyGatekeeperStatusState extends State<MyGatekeeperStatus> {
  late final Stream<List<Map<String,dynamic>>> stream;
  @override void initState(){super.initState();stream=tgSupabase.from('unlock_requests').stream(primaryKey:['id']).eq('requester_id',tgSupabase.auth.currentUser!.id).order('created_at',ascending:false);}
  Future<void> cancel(String id) async {try {await tgSupabase.functions.invoke('gatekeeper-ops',body:{'action':'cancel-unlock-request','requestId':id});await tgSupabase.functions.invoke('gatekeeper-ops',body:{'action':'cleanup'});}catch(_) {}}
  @override Widget build(BuildContext context)=>StreamBuilder(stream:stream,builder:(context,snapshot){final rows=(snapshot.data??[]).take(3).toList();if(rows.isEmpty)return const SizedBox.shrink();return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Padding(padding:EdgeInsets.only(top:8,bottom:5),child:Text('Recent Gatekeeper requests',style:TextStyle(fontWeight:FontWeight.bold))),...rows.map((r){final status=r['status'];return Card(child:ListTile(title:Text('${r['target_key']} · ${status.toString().toUpperCase()}'),subtitle:Text(status=='pending'?'Waiting for a decision; unanswered requests expire after 24 hours.':status=='approved'?'A 60-second cooldown applies, then your selected pass begins.':status=='rejected'?'Your Gatekeeper declined this request.':status=='cancelled'?'You cancelled this request.':'This request expired.'),trailing:status=='pending'?TextButton(onPressed:()=>cancel(r['id']),child:const Text('Cancel')):null));})]);});
}
