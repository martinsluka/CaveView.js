
uniform float cursor;
uniform float cursorWidth;

uniform vec3 baseColor;
uniform vec3 cursorColor;

varying float vDepth;

#ifdef SURFACE

uniform vec3 uLight;

varying vec3 vNormal;

#else

varying vec3 vColor;

#endif

void main() {

	float light;

#ifdef SURFACE

	float nDot = dot( normalize( vNormal ), uLight );
	light = 0.5 * ( nDot + 1.0 );

#else

	light = 1.0;

#endif

	float delta = abs( vDepth - cursor );
	float ss = smoothstep( 0.0, cursorWidth, cursorWidth - delta );

#ifdef SURFACE

	if ( delta < cursorWidth * 0.05 ) {

		gl_FragColor = vec4( 1.0, 1.0, 1.0, 1.0 ) * light;

	} else {

		gl_FragColor = vec4( mix( baseColor, cursorColor, ss ) * light, 1.0 );

	}

#else

	if ( delta < cursorWidth * 0.05 ) {

		gl_FragColor = vec4( 1.0, 1.0, 1.0, 1.0 ) * light * vec4( vColor, 1.0 );

	} else {

		gl_FragColor = vec4( mix( baseColor, cursorColor, ss ) * light, 1.0 ) * vec4( vColor, 1.0 );

	}

#endif

}