exports.index = function(req, res){
	res.render('about', { title: 'About BitcoinTax', errors: req.flash('error'), page: 'about'});  
};