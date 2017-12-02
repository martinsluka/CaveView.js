
function glsl () {
	return {
		transform ( code, id ) {
			if ( !/\.glsl$/.test( id ) ) return;

			return 'export default ' + JSON.stringify(
				code
					.replace( /[ \t]*\/\/.*\n/g, '' )
					.replace( /[ \t]*\/\*[\s\S]*?\*\//g, '' )
					.replace( /\n{2,}/g, '\n' )
			) + ';';
		}
	};
}

export default {
	input: 'src/js/CV.js',
	name: 'CV',
	output: {
		file: 'build/CaveView/js/CaveView.js',
		format: 'umd'
	},
	plugins: [
		glsl()
	]
};