var http = require('http');
var https = require('https');
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var kill = require('tree-kill');

app.use(bodyParser.json());

app.use(function timeLog(req, res, next) {
	console.log('an incomming request @ ./. Time: ', Date.now());
	res.header("Access-Control-Allow-Origin", "*");
	next();
});

var secure_http = false;
var console_port = 5573;
var cmd = 'notepad.exe';
var sslCredentials = {};

var childPid = null;
var relaunch = true;

process.on('SIGINT', function() {
    console.log("Caught interrupt signal");
	relaunch = false;
	if (childPid) {
		console.log('killing child process ' + childPid);
		kill(childPid, 'SIGKILL', function(err) {
			console.log('child process fully killed');
			process.exit();
		});
	}
	else
		process.exit();
});

function runChildProcess(cmd) {
	console.log('launching child process... cmd=' + cmd);
	var exec = require('child_process').exec;
	var child = exec(cmd, {});
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.on('exit', function(code) {
		console.log('child process exits with code=' + code);
		childPid = null;
		if (relaunch) {
			console.log('re-launching child process...');
			runChildProcess(cmd);
		}
	});
	childPid = child.pid;
	console.log('new child process pid=' + childPid);
}

function restartChildProcess(cmd, onDone) {
	console.log('restarting child process. current pid=' +childPid);
	if (childPid) {
		console.log('killing child process ' + childPid);
		kill(childPid, 'SIGKILL', function(err) {
			console.log('old child process fully killed');
			if (typeof onDone === 'function') onDone(childPid);
		});
	}
	else {
		runChildProcess(cmd);
		if (typeof onDone === 'function') onDone(childPid);
	}
}

runChildProcess(cmd);

var router = express.Router();
router.use(function timeLog(req, res, next) {
	console.log('an incomming request @ /xy_node_serv. Time: ', Date.now()); 
 	next(); 
}); 
router.get('/hello', function(request, result) {
	result.json({"message": "Hi from XY Node.js Service", "pid": childPid});
});
router.get('/restart_child', function(request, result) {
	restartChildProcess(cmd, function(pid) {
		result.json({"pid": pid});
	});
});
router.all('/', function(request, result) {
	result.set('Content-Type', 'application/json');
	result.json({"exception":"bad request"});
});

app.use('/xy_node_serv', router);

var serverConsole = (secure_http ? https.createServer(sslCredentials, app) : http.createServer(app));
serverConsole.listen(console_port, function() {
	var host = serverConsole.address().address;
	var port = serverConsole.address().port;
	console.log('console listening at %s://%s:%s', (secure_http ? 'https' : 'http'), host, port);
});
