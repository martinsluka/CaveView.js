
import { Cfg } from '../core/lib';

const HudObject = {

	stdWidth: Cfg.themeValue( 'hud.widgetSize' ),
	stdMargin: 5,

	atlasSpec: {
		color: Cfg.themeColorCSS( 'hud.text' ),
		font: 'normal helvetica,sans-serif'
	}

};

export { HudObject };

// EOF