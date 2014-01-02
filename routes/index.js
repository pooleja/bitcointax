
/*
 * GET home page.
 */

var https = require('https');
var http = require('http');
var blockchain = require("blockchain.wrapper");
var bitcoinAddress = require("bitcoin-address");
var moment = require('moment');
var async = require('async');

exports.index = function(req, res){
	/*blockchain.getAddressInfo("167iUyrWZEtcofuY3byNgqjyJUm3z6qXkc", function(addressInfo, err){
		if(err)
			res.send(err);
		else
			res.render('index', { title: 'BitcoinTax', info: addressInfo });
	});*/

	var params = { title: 'BitcoinTax'};

	// First get the current price
	getCurrentPrice(req, res, function(req, res){

		getAddressesFromSession(req);

		// Next get the transaction info for the addresses
		getAddressesInfo(req, res, function(req, res){

			// Ensure the error messages are in the session
			params["errors"] =  req.flash('error');
			params['addresses'] = req.session.addresses;
			params['transactions'] = req.session.transactions;
			params['price'] = req.session.price;

			// Render the page with the data stored in params
			res.render('index', params);			
		});		
	});	
  
};

function getCurrentPrice(req, res, callback){

	if(req.session.price){
		callback(req, res);
	}
	else{
		https.get('https://coinbase.com/api/v1/prices/spot_rate', function(coinRes) {
		    var body = '';

		    coinRes.on('data', function(chunk) {
		        body += chunk;
		    });

		    coinRes.on('end', function() {
		        var goxResponse = JSON.parse(body)		        
		        req.session.price = goxResponse.amount;
	    		callback(req, res);
		    });
		}).on('error', function(e) {
		      console.log("Got error: ", e);
		});
	}	

}

function getAddressesInfo(req, res, callback){	

	var addressList = "";

	// Verify there are addresses to process and get out if not
	if(req.session.addresses.length == 0){
		req.session.transactions = [];	
		callback(req, res);
	}
	else{

		req.session.transactions = [];

		// Asynchronously call the API to get blockchain info
		async.map(req.session.addresses, getBlockChainInfo, function(err, results){
	    	if(err)
	    		console.log("Got error: ", err);
	    	else{
	    		for (var i=0; i < results.length; i++){			
			        var addressTrx = results[i];
			        for (var j=0; j < addressTrx.length; j++){
			        	req.session.transactions.push(addressTrx[j]);
			        }
			    }

			    req.session.transactions.sort(compareTrx)
	    		callback(req, res);
	    	}
	    		
		});        
					
	}
}

function compareTrx(a,b) {
  if (a.date < b.date)
     return -1;
  if (a.date > b.date)
    return 1;
  return 0;
}


function getBlockChainInfo(address, callback){	

	http.get('http://blockchain.info/multiaddr?active=' + address , function(data) {
			var body = '';

		    data.on('data', function(chunk) {
		        body += chunk;
		    });

		    data.on('end', function() {
		        var addressResponse = JSON.parse(body);
		        var transactions = 	getTransactions(addressResponse);  		        
	    		callback(null, transactions);
		    });
		}).on('error', function(e) {
		      console.log("Got error: ", e);
		      callback(e);
	});
}

function getTransactions(info){

	var transactions = [];
	for (var i=0; i < info.txs.length; i++){			
        transactions.push(convertTransaction(info.txs[i], info.info.conversion));
    }	

    return transactions;
}

function convertTransaction(tx, conversionFactor){

	var tempTransaction = {};
	
	var incoming = true;
	if(tx.result < 0)
		incoming = false;

	tempTransaction['date'] = new Date(tx.time * 1000);
	tempTransaction['date_str'] = moment(tx.time * 1000).format("YYYY-MM-DD");
	tempTransaction['incoming'] = incoming;
	tempTransaction['btc_amount'] = tx.result / conversionFactor;
	tempTransaction['btc_price'] = 1000;

	return tempTransaction;
}

function getAddressesFromSession(req){
	
	var addresses = [];	

	if(req.session.addresses) {
		for (var i=0; i < req.session.addresses.length; i++){			
            addresses.push(req.session.addresses[i]);
        }
	}

	if(req.body.newAddress){
		if(bitcoinAddress.validate(req.body.newAddress))
			addresses.push(req.body.newAddress);
		else
			req.flash('error', 'Invalid address entered: ' + req.body.newAddress);
	}
			
	
	req.session.addresses = addresses;

	return addresses;
}

function getPriceForDate(d){
	//http://www.quandl.com/api/v1/datasets/BCHAIN/MKPRU.json
	return 1000;
}