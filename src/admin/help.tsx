import { Layout } from "./layout";
import { Icon, type IconName } from "./ui";
import type { AdminApp } from "./index";

const sections: { title: string; icon: IconName; steps: string[] }[] = [
  {
    title: "Add a photo",
    icon: "camera",
    steps: [
      "Tap Add photo in the menu and type part of the product's name.",
      "Tap Take a photo to use the camera, or Choose from gallery to pick photos you already have. You can pick several at once.",
      "Use daylight and a plain wall or floor, with the whole pot in the photo. No price tags or hands.",
      "The first photo is the one customers see in the shop list.",
      "On a computer, drag photos onto the product page.",
    ],
  },
  {
    title: "Change a name or description",
    icon: "leaf",
    steps: [
      "Tap Products, then tap the product.",
      "Change the name as customers would say it, or the description.",
      "Tap Save changes.",
    ],
  },
  {
    title: "Sizes and stock",
    icon: "grip",
    steps: [
      "Open the product and go down to Sizes.",
      "Add a size, or switch In stock off when it is sold out. Then tap Save sizes.",
      "Every product keeps at least one size, so the last one cannot be removed.",
    ],
  },
  {
    title: "Hide a product",
    icon: "x",
    steps: [
      "Open the product.",
      "Switch Showing in shop off. Customers stop seeing it after the next publish.",
      "Switch it on again any time. A product needs a photo and a shop category to show.",
    ],
  },
  {
    title: "Publish the website",
    icon: "upload",
    steps: [
      "Tap Publish, then Publish now. Your changes go on the website.",
      "It takes about 3 minutes. The website stays open while it updates.",
      "No need to publish every time: the website also updates by itself every night at 2 am.",
    ],
  },
];

export function mountHelp(admin: AdminApp) {
  admin.get("/admin/help", (c) =>
    c.html(
      <Layout
        title="Help"
        email={c.var.staffEmail}
        active="help"
        help={{
          title: "Using Help",
          steps: [
            "Every screen has a ? button at the top. Tap it for help with that screen.",
            "This page has all the help in one place. Find the job you want to do and follow the steps.",
          ],
        }}
        tip="every screen has a ? button at the top with help for that screen."
      >
        {sections.map((s) => (
          <section class="card">
            <h2>
              <span class="mark">
                <Icon name={s.icon} />
              </span>
              {s.title}
            </h2>
            <ol>
              {s.steps.map((step) => (
                <li>{step}</li>
              ))}
            </ol>
          </section>
        ))}
        <p class="who">Signed in as {c.var.staffEmail}</p>
      </Layout>,
    ),
  );
}
