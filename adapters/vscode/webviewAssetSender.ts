/**
 * Webview asset senders — VS Code host only.
 *
 * Loading assets from disk is shared by every host (see server/src/assetLoader.ts).
 * Pushing them into a `vscode.Webview` is not: standalone broadcasts over WebSocket
 * instead. These five functions live here so the server never imports `vscode`.
 */

import type * as vscode from 'vscode';

import type {
  LoadedAssets,
  LoadedCharacterSprites,
  LoadedFloorTiles,
  LoadedPetSprites,
  LoadedWallTiles,
} from '../../server/src/assetLoader.js';

/**
 * Send wall tiles to webview
 */
export function sendWallTilesToWebview(webview: vscode.Webview, wallTiles: LoadedWallTiles): void {
  webview.postMessage({
    type: 'wallTilesLoaded',
    sets: wallTiles.sets,
  });
  console.log(`📤 Sent ${wallTiles.sets.length} wall tile set(s) to webview`);
}

/**
 * Send floor tiles to webview
 */
export function sendFloorTilesToWebview(
  webview: vscode.Webview,
  floorTiles: LoadedFloorTiles,
): void {
  webview.postMessage({
    type: 'floorTilesLoaded',
    sprites: floorTiles.sprites,
  });
  console.log(`📤 Sent ${floorTiles.sprites.length} floor tile patterns to webview`);
}

/**
 * Send character sprites to webview
 */
export function sendCharacterSpritesToWebview(
  webview: vscode.Webview,
  charSprites: LoadedCharacterSprites,
): void {
  webview.postMessage({
    type: 'characterSpritesLoaded',
    characters: charSprites.characters,
  });
  console.log(`📤 Sent ${charSprites.characters.length} character sprites to webview`);
}

/**
 * Send loaded assets to webview
 */
export function sendAssetsToWebview(webview: vscode.Webview, assets: LoadedAssets): void {
  if (!assets) {
    console.log('[AssetLoader] ⚠️  No assets to send');
    return;
  }

  console.log('[AssetLoader] Converting sprites Map to object...');
  // Convert sprites Map to plain object for JSON serialization
  const spritesObj: Record<string, string[][]> = {};
  for (const [id, spriteData] of assets.sprites) {
    spritesObj[id] = spriteData;
  }

  console.log(
    `[AssetLoader] Posting furnitureAssetsLoaded message with ${assets.catalog.length} assets`,
  );
  webview.postMessage({
    type: 'furnitureAssetsLoaded',
    catalog: assets.catalog,
    sprites: spritesObj,
  });

  console.log(`📤 Sent ${assets.catalog.length} furniture assets to webview`);
}

/**
 * Send pet sprites to webview.
 * Wire format: parallel arrays `pets[i]` (frame data) and `petNames[i]` (display
 * names from manifest.json). Manifest IDs are dropped — the webview indexes by
 * `petType: number`.
 */
export function sendPetSpritesToWebview(
  webview: vscode.Webview,
  petSprites: LoadedPetSprites,
): void {
  webview.postMessage({
    type: 'petSpritesLoaded',
    pets: petSprites.pets,
    petNames: petSprites.manifests.map((m) => m.name),
  });
  console.log(`📤 Sent ${petSprites.pets.length} pet sprites to webview`);
}
