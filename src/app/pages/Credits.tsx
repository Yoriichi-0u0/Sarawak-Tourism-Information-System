import { Camera, Images } from "lucide-react";

import { mediaLibrary } from "../../shared/media";
import { MediaCredit, Picture, useTitle } from "../ui";

export function CreditsPage() {
  useTitle("Image credits");
  const photos = mediaLibrary.filter(({ kind }) => kind === "photo");
  const illustrations = mediaLibrary.filter(({ kind }) => kind === "illustration");
  return <div className="stack" style={{ gap: 24 }}>
    <div><p className="eyebrow"><Images size={16} aria-hidden="true" />About the pictures</p><h1>Image credits</h1>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        STIS uses real photographs of Sarawak wherever a suitably licensed one exists. Each photo below is credited to its author with its licence and source.
        On a listing, a photo is either a picture of that place or service, or clearly marked as representative, for example a typical dish rather than the
        restaurant itself. Images were resized, cropped for display and re-encoded; for CC BY-SA photos those versions are shared under the same licence.
      </p></div>
    <section aria-labelledby="photos-title" className="stack">
      <h2 id="photos-title"><Camera size={20} aria-hidden="true" /> Photographs ({photos.length})</h2>
      <ul className="credits-grid">
        {photos.map((asset) => <li key={asset.id} className="credit-card">
          <div className="credit-thumb"><Picture asset={asset} sizes="(max-width: 640px) 100vw, 300px" /></div>
          <div><strong>{asset.subject}</strong>
            <p className="small" style={{ margin: "4px 0 0" }}><MediaCredit asset={asset} /></p>
            <p className="small muted" style={{ margin: "4px 0 0" }}>Original file: {asset.title}</p></div>
        </li>)}
      </ul>
    </section>
    <section aria-labelledby="illustrations-title" className="stack">
      <h2 id="illustrations-title">Generated illustrations ({illustrations.length})</h2>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>These images were created with an AI image model for STIS. They are used only on clearly labelled demonstration listings that do not describe a real business, and are never presented as photographs of real places.</p>
      <ul className="credits-grid">
        {illustrations.map((asset) => <li key={asset.id} className="credit-card">
          <div className="credit-thumb"><Picture asset={asset} sizes="(max-width: 640px) 100vw, 300px" /></div>
          <div><strong>{asset.subject}</strong><p className="small" style={{ margin: "4px 0 0" }}><MediaCredit asset={asset} /></p></div>
        </li>)}
      </ul>
    </section>
    <p className="small muted" style={{ maxWidth: "70ch" }}>The Sarawak Tourism Board photo gallery requires a member login to download. Its photos are not used until they are downloaded through that process, with its non-commercial and credit conditions recorded here.</p>
  </div>;
}
