import { PointsMaterial } from '../Three';

function ExtendedPointsMaterial ( ctx ) {

	PointsMaterial.call( this );

	const colourCache = ctx.materials.colourCache;
	const textureCache = ctx.materials.textureCache;

	this.map = textureCache.getTexture( 'disc' );
	this.color = colourCache.white;
	this.opacity = 1.0;
	this.alphaTest = 0.8;

	this.sizeAttenuation = false;
	this.transparent = true; // to ensure points rendered over lines.
	this.vertexColors = true;

	this.onBeforeCompile = function ( shader ) {

		var vertexShader = shader.vertexShader
			.replace( '#include <common>', '\nattribute float pSize;\n\n$&' )
			.replace( '\tgl_PointSize = size;', '\tgl_PointSize = pSize;' );

		shader.vertexShader = vertexShader;

	};

	return this;

}

ExtendedPointsMaterial.prototype = Object.create( PointsMaterial.prototype );

export { ExtendedPointsMaterial };