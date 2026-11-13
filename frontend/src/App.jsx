import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function App() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="font-heading text-3xl font-semibold">Unique Empire</h1>
        <Card>
          <CardContent className="space-y-1 pt-4">
            <p className="text-sm text-muted-foreground">
              Completed sales today
            </p>
            <p className="font-heading text-4xl font-semibold tabular">
              ₦184,500.00
            </p>
          </CardContent>
        </Card>
        <Button className="h-12 w-full text-base">Take payment</Button>
      </div>
    </div>
  );
}
